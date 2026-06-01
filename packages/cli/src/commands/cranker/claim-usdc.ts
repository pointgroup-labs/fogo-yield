import type { TransactionInstruction } from '@solana/web3.js'
import { describeStatus, findAuthorityPda, findUserInboxAuthorityPda, NTT_USDC_PROGRAM_ID, resolveNttVaa, USDC_MINT } from '@fogo-onre/sdk'
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from '@solana/spl-token'
import { Connection, PublicKey, SystemProgram } from '@solana/web3.js'
import chalk from 'chalk'
import { Command } from 'commander'
import { runTx, useContext } from '../../context'
import { autoDetectUserWallet, DEFAULT_WORMHOLESCAN_URL, fetchVaaBytes, FOGO_RPC_DEFAULT, UserWalletSource } from './shared'

export function claimUsdcCommand(): Command {
  return new Command('claim-usdc')
    .description('Claim a bridged USDC.s VAA into the per-user inbox ATA (deposit leg, step 1)')
    .requiredOption('--fogo-tx <signature>', 'FOGO tx signature that emitted the bridge VAA')
    .option('--vaa <hex>', 'Override Wormholescan lookup with raw signed VAA bytes (hex)')
    .option('--user-wallet <pubkey>', 'Override wallet attribution (default: VAA sender field)')
    .option('--usdc-mint <pubkey>', `USDC mint on Solana (default: ${USDC_MINT.toBase58()})`)
    .option('--ntt-program <pubkey>', `NTT USDC.s manager program id (default: ${NTT_USDC_PROGRAM_ID.toBase58()})`)
    .option('--wormholescan-url <url>', `Wormholescan REST base URL [default: ${DEFAULT_WORMHOLESCAN_URL}]`)
    .option('--fogo-rpc <url>', `FOGO RPC URL for Sessions wallet recovery [env: FOGO_RPC_URL, default: ${FOGO_RPC_DEFAULT}]`)
    .option('--confirm', 'Actually broadcast the transaction (default: dry-run)')
    .action(async (opts: {
      fogoTx: string
      vaa?: string
      userWallet?: string
      usdcMint?: string
      nttProgram?: string
      wormholescanUrl?: string
      fogoRpc?: string
      confirm?: boolean
    }) => {
      const { connection, keypair, client } = useContext()
      const usdcMint = opts.usdcMint ? new PublicKey(opts.usdcMint) : USDC_MINT
      const nttProgram = opts.nttProgram ? new PublicKey(opts.nttProgram) : NTT_USDC_PROGRAM_ID
      const fogoRpcUrl = opts.fogoRpc ?? process.env.FOGO_RPC_URL ?? FOGO_RPC_DEFAULT
      const fogoConnection = new Connection(fogoRpcUrl, 'confirmed')

      const vaaBytes = await fetchVaaBytes({
        fogoTx: opts.fogoTx,
        vaaHex: opts.vaa,
        wormholescanUrl: opts.wormholescanUrl,
      })
      const resolved = resolveNttVaa({ vaaBytes, nttProgramId: nttProgram })

      // Resolve the wallet that seeds the per-user inbox PDA. For a
      // Sessions deposit the VAA `sender` is the session keypair, not the
      // user's main wallet, so we auto-detect via `autoDetectUserWallet`
      // (see its JSDoc) and fall back to `senderOnSource` so Pre-flight 4
      // throws the standard mismatch diagnostic.
      let userWallet: PublicKey
      let userWalletSource: UserWalletSource
      if (opts.userWallet) {
        userWallet = new PublicKey(opts.userWallet)
        userWalletSource = 'flag'
      } else {
        const auto = await autoDetectUserWallet({
          programId: client.program.programId,
          signer: keypair.publicKey,
          resolved,
          fogoConnection,
          fogoTx: opts.fogoTx,
        })
        if (auto) {
          userWallet = auto.wallet
          userWalletSource = auto.source
        } else {
          // Neither candidate matches — fall through to senderOnSource so
          // Pre-flight 4 can throw with the standard mismatch diagnostic.
          userWallet = resolved.senderOnSource
          userWalletSource = 'sender-fallback'
        }
      }
      const defaultedUserWallet = userWalletSource !== 'flag'

      // Pre-flight 1: RelayerConfig must exist (otherwise `claim_usdc`'s
      // `has_one` validation panics with a confusing Anchor error).
      const cfg = await connection.getAccountInfo(client.configPda).catch(() => null)
      if (!cfg) {
        throw new Error(`RelayerConfig not found at ${client.configPda.toBase58()} — relayer not initialized on this RPC`)
      }

      // Pre-flight 2: refuse to crank if a Flow PDA already exists.
      // claim_usdc would silently fail with `init_if_needed`-on-existing,
      // and re-attempting wastes the operator's gas — better to bail
      // with a clear "already cranked" message.
      const existing = await client.fetchInflightFlow(resolved.nttInboxItem).catch(() => null)
      if (existing) {
        throw new Error(
          `Inflight Flow already exists for inbox-item ${resolved.nttInboxItem.toBase58()} — `
          + `claim_usdc has already run (status=${describeStatus(existing.status)}).`,
        )
      }

      // Pre-flight 3: the per-user inbox ATA must exist when `claim_usdc`
      // runs — the relayer constraint refuses `init_if_needed`. Normally
      // FOGO `bridge_ntt_tokens` (pay_destination_ata_rent) creates it;
      // in this manual crank path we prepend an idempotent create ourselves.
      const [userInboxAuthority] = findUserInboxAuthorityPda(
        userWallet,
        client.program.programId,
      )
      const userInboxAta = getAssociatedTokenAddressSync(
        usdcMint,
        userInboxAuthority,
        true, // PDA owner
      )

      // Pre-flight 4: the derived inbox-authority PDA must equal the
      // recipient pinned into the VAA's NTT inbox-item. If they
      // disagree, `claim_usdc.rs:271` will trip `UserInboxAuthorityMismatch`
      // mid-tx and burn the operator's gas. Catch it client-side with
      // a precise message that names the recovery action.
      if (!userInboxAuthority.equals(resolved.recipientOnSolana)) {
        const hint = defaultedUserWallet
          ? ` The CLI exhausted all three auto-detect probes (signer, VAA sender, FOGO source-ATA owner) and fell back to the VAA sender (${resolved.senderOnSource.toBase58()}); none derived a matching PDA.`
          : ''
        throw new Error(
          `derived inbox-authority PDA (${userInboxAuthority.toBase58()}) does not match the VAA's recorded recipient (${resolved.recipientOnSolana.toBase58()}).${hint} Re-run with --user-wallet=<main_fogo_wallet> matching the wallet that initiated the deposit on FOGO.`,
        )
      }
      const ensureUserInboxAtaIx = createAssociatedTokenAccountIdempotentInstruction(
        keypair.publicKey,
        userInboxAta,
        userInboxAuthority,
        usdcMint,
      )

      console.log(chalk.cyan('claim-usdc plan'))
      console.log(chalk.dim(`  payer (signer):         ${keypair.publicKey.toBase58()}`))
      console.log(chalk.dim(`  userWallet:             ${userWallet.toBase58()}${userWalletSource === 'flag' ? '' : chalk.dim(` (auto: ${userWalletSource})`)}`))
      console.log(chalk.dim(`  usdcMint:               ${usdcMint.toBase58()}`))
      console.log(chalk.dim(`  nttProgram:             ${nttProgram.toBase58()}`))
      console.log(chalk.dim(`  userInboxAuthority:     ${userInboxAuthority.toBase58()}`))
      console.log(chalk.dim(`  userInboxAta:           ${userInboxAta.toBase58()} (ensure-idempotent)`))
      console.log(chalk.dim(`  nttInboxItem:           ${resolved.nttInboxItem.toBase58()}`))
      console.log(chalk.dim(`  nttTransceiverMessage:  ${resolved.nttTransceiverMessage.toBase58()}`))
      console.log(chalk.dim(`  trimmedAmount:          ${resolved.manager.trimmedAmount} (decimals=${resolved.manager.trimmedDecimals})`))

      if (!opts.confirm) {
        console.log()
        console.log(chalk.yellow('dry-run only. Re-run with --confirm to broadcast.'))
        return
      }

      console.log()
      // Top-up: NTT redeem inits `inbox_item` with relayer_authority as
      // payer (~1.41M); a bare PDA holds only its own ~1.14M rent-exempt
      // minimum, so top up to 3M (idempotent above target).
      const [relayerAuthorityPdaForClaim] = findAuthorityPda(client.program.programId)
      const relayerAuthInfoForClaim = await connection.getAccountInfo(relayerAuthorityPdaForClaim).catch(() => null)
      const RELAYER_AUTH_TOPUP_CLAIM = 3_000_000n
      const existingRelayerAuthLamports = BigInt(relayerAuthInfoForClaim?.lamports ?? 0)
      const preIxs: TransactionInstruction[] = [ensureUserInboxAtaIx]
      if (existingRelayerAuthLamports < RELAYER_AUTH_TOPUP_CLAIM) {
        preIxs.unshift(SystemProgram.transfer({
          fromPubkey: keypair.publicKey,
          toPubkey: relayerAuthorityPdaForClaim,
          lamports: Number(RELAYER_AUTH_TOPUP_CLAIM - existingRelayerAuthLamports),
        }))
      }
      const sig = await runTx(() =>
        client
          .receive({
            payer: keypair.publicKey,
            direction: { deposit: {} },
            userWallet,
            recvMint: usdcMint,
            nttInboxItem: resolved.nttInboxItem,
            nttTransceiverMessage: resolved.nttTransceiverMessage,
            // For OnRe's NTT deployment the registered transceiver IS the
            // NTT manager program itself — the transceiver is compiled
            // into the manager binary. See `tests/utils/withdraw-scaffolding.ts:212`
            // for the same wiring on the ONyc side.
            ntt: { transceiverAddress: nttProgram },
          })
          .preInstructions(preIxs)
          .rpc(),
      )

      console.log(chalk.green('claim-usdc landed'))
      console.log(chalk.dim(`  tx: ${sig}`))
    })
}
