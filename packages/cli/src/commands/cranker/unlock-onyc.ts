import { describeStatus, findNttPeerPda, findUserInboxAuthorityPda, FOGO_WORMHOLE_CHAIN_ID, NTT_ONYC_PROGRAM_ID, resolveNttVaa } from '@fogo-onre/sdk'
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from '@solana/spl-token'
import { Connection, PublicKey } from '@solana/web3.js'
import chalk from 'chalk'
import { Command } from 'commander'
import { runTx, useContext } from '../../context'
import { autoDetectUserWallet, DEFAULT_WORMHOLESCAN_URL, fetchVaaBytes, FOGO_RPC_DEFAULT, UserWalletSource } from './shared'

// ─────────────────────────────────────────────────────────────────────
// Withdraw-leg commands. Mirror of the daemon handlers in
// `packages/cranker/src/relayer/{unlock-onyc,swap-onyc-to-usdc,
// send-usdc-to-user}.ts`. Same pre-flight gates, same race semantics,
// but with `--confirm`-gated dry-run plans for operator manual recovery
// (the daemon does this all automatically).
//
// The withdraw chain originates on FOGO from the user's `transfer_burn`
// + `release_wormhole_outbound` (now bundled atomically by the webapp;
// pre-fix stranded items use `scripts/release-fogo-outbound.mjs` to
// produce the missing VAA). The three steps below then run on Solana:
//   unlock-onyc → swap-onyc-to-usdc → send-usdc-to-user
// ─────────────────────────────────────────────────────────────────────

export function unlockOnycCommand(): Command {
  return new Command('unlock-onyc')
    .description('Redeem ONyc burn VAA from FOGO + init outflight Flow (withdraw leg, step 1)')
    .requiredOption('--fogo-tx <signature>', 'FOGO tx signature that emitted the burn VAA')
    .option('--vaa <hex>', 'Override Wormholescan lookup with raw signed VAA bytes (hex)')
    .option('--user-wallet <pubkey>', 'Override wallet attribution (default: auto-detect from FOGO tx)')
    .option('--ntt-program <pubkey>', `NTT ONyc manager program id (default: ${NTT_ONYC_PROGRAM_ID.toBase58()})`)
    .option('--wormholescan-url <url>', `Wormholescan REST base URL [default: ${DEFAULT_WORMHOLESCAN_URL}]`)
    .option('--fogo-rpc <url>', `FOGO RPC URL for Sessions wallet recovery [env: FOGO_RPC_URL, default: ${FOGO_RPC_DEFAULT}]`)
    .option('--confirm', 'Actually broadcast the transaction (default: dry-run)')
    .action(async (opts: {
      fogoTx: string
      vaa?: string
      userWallet?: string
      nttProgram?: string
      wormholescanUrl?: string
      fogoRpc?: string
      confirm?: boolean
    }) => {
      const { connection, keypair, client } = useContext()
      const nttProgram = opts.nttProgram ? new PublicKey(opts.nttProgram) : NTT_ONYC_PROGRAM_ID
      const fogoRpcUrl = opts.fogoRpc ?? process.env.FOGO_RPC_URL ?? FOGO_RPC_DEFAULT
      const fogoConnection = new Connection(fogoRpcUrl, 'confirmed')

      const vaaBytes = await fetchVaaBytes({ fogoTx: opts.fogoTx, vaaHex: opts.vaa, wormholescanUrl: opts.wormholescanUrl })
      const resolved = resolveNttVaa({ vaaBytes, nttProgramId: nttProgram })

      // Pre-flight 1: RelayerConfig present.
      const cfgInfo = await connection.getAccountInfo(client.configPda).catch(() => null)
      if (!cfgInfo) {
        throw new Error(`RelayerConfig not found at ${client.configPda.toBase58()} — relayer not initialized on this RPC`)
      }
      const cfg = await client.fetchConfig()
      const onycMint = cfg.assetMint as PublicKey

      // Redeem routes through the OnRe intent fork, so the VTM sender is
      // the setter PDA and attribution rides on the NTT recipient =
      // per-user inbox PDA. Recover `userWallet` the same way `claim-usdc`
      // does: probe [signer, VAA sender, FOGO source-ATA owner] for the
      // one that derives the inbox-authority PDA the VAA targets.
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
          userWallet = resolved.senderOnSource
          userWalletSource = 'sender-fallback'
        }
      }
      const defaultedUserWallet = userWalletSource !== 'flag'

      // Pre-flight 2: outflight Flow must NOT exist.
      const existing = await client.fetchOutflightFlow(resolved.nttInboxItem).catch(() => null)
      if (existing) {
        throw new Error(
          `Outflight Flow already exists for inbox-item ${resolved.nttInboxItem.toBase58()} — `
          + `unlock_onyc has already run (status=${describeStatus(existing.status)}).`,
        )
      }

      // Pre-flight 3: FOGO peer registered on the ONyc NTT manager.
      const [fogoPeerPda] = findNttPeerPda(FOGO_WORMHOLE_CHAIN_ID, nttProgram)
      const peerInfo = await connection.getAccountInfo(fogoPeerPda).catch(() => null)
      if (!peerInfo) {
        throw new Error(
          `FOGO peer not registered on ONyc NTT manager (${fogoPeerPda.toBase58()}) — `
          + `operator must run NTT register-peer for FOGO chain ${FOGO_WORMHOLE_CHAIN_ID} before unlock_onyc can succeed.`,
        )
      }

      // Pre-flight 4: derived inbox-authority must equal the VAA recipient
      // (else unlock_onyc trips UserInboxAuthorityMismatch mid-tx). The
      // per-user inbox ATA is created idempotently — FOGO
      // `bridge_ntt_tokens` usually pre-funds it, but the manual crank
      // path can't assume the executor ran.
      const [userInboxAuthority] = findUserInboxAuthorityPda(userWallet, client.program.programId)
      const userInboxAta = getAssociatedTokenAddressSync(onycMint, userInboxAuthority, true)
      if (!userInboxAuthority.equals(resolved.recipientOnSolana)) {
        const hint = defaultedUserWallet
          ? ` The CLI exhausted all three auto-detect probes (signer, VAA sender, FOGO source-ATA owner) and fell back to the VAA sender (${resolved.senderOnSource.toBase58()}); none derived a matching PDA.`
          : ''
        throw new Error(
          `derived inbox-authority PDA (${userInboxAuthority.toBase58()}) does not match the VAA's recorded recipient (${resolved.recipientOnSolana.toBase58()}).${hint} Re-run with --user-wallet=<main_fogo_wallet> matching the wallet that initiated the redeem on FOGO.`,
        )
      }
      const ensureUserInboxAtaIx = createAssociatedTokenAccountIdempotentInstruction(
        keypair.publicKey,
        userInboxAta,
        userInboxAuthority,
        onycMint,
      )

      console.log(chalk.cyan('unlock-onyc plan'))
      console.log(chalk.dim(`  payer (signer):         ${keypair.publicKey.toBase58()}`))
      console.log(chalk.dim(`  userWallet:             ${userWallet.toBase58()}${userWalletSource === 'flag' ? '' : chalk.dim(` (auto: ${userWalletSource})`)}`))
      console.log(chalk.dim(`  onycMint:               ${onycMint.toBase58()}`))
      console.log(chalk.dim(`  nttProgram:             ${nttProgram.toBase58()}`))
      console.log(chalk.dim(`  nttInboxItem:           ${resolved.nttInboxItem.toBase58()}`))
      console.log(chalk.dim(`  nttTransceiverMessage:  ${resolved.nttTransceiverMessage.toBase58()}`))
      console.log(chalk.dim(`  userInboxAuthority:     ${userInboxAuthority.toBase58()}`))
      console.log(chalk.dim(`  userInboxAta:           ${userInboxAta.toBase58()} (ensure-idempotent)`))
      console.log(chalk.dim(`  trimmedAmount:          ${resolved.manager.trimmedAmount} (decimals=${resolved.manager.trimmedDecimals})`))
      console.log(chalk.dim(`  fogoPeerPda:            ${fogoPeerPda.toBase58()} ✓`))

      if (!opts.confirm) {
        console.log()
        console.log(chalk.yellow('dry-run only. Re-run with --confirm to broadcast.'))
        return
      }

      console.log()
      const sig = await runTx(() =>
        client
          .receive({
            payer: keypair.publicKey,
            direction: { withdraw: {} },
            userWallet,
            recvMint: onycMint,
            nttInboxItem: resolved.nttInboxItem,
            nttTransceiverMessage: resolved.nttTransceiverMessage,
            ntt: { transceiverAddress: nttProgram },
          })
          .preInstructions([ensureUserInboxAtaIx])
          .rpc(),
      )
      console.log(chalk.green('unlock-onyc landed'))
      console.log(chalk.dim(`  tx: ${sig}`))
    })
}
