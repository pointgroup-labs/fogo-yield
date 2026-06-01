import type { TransactionInstruction } from '@solana/web3.js'
import { describeStatus, findAuthorityPda, findNttPeerPda, findSessionAuthorityPda, FOGO_WORMHOLE_CHAIN_ID, NTT_ONYC_PROGRAM_ID, NTT_USDC_PROGRAM_ID, nttTransferArgsHash, resolveNttVaa } from '@fogo-onre/sdk'
import { Keypair, PublicKey, SystemProgram } from '@solana/web3.js'
import chalk from 'chalk'
import { Command } from 'commander'
import { runTx, useContext } from '../../context'
import { DEFAULT_NTT_VERSION, DEFAULT_WORMHOLESCAN_URL, deriveLockOnycReleaseAccounts, fetchVaaBytes, makeSolanaNtt, WORMHOLE_CORE_MAINNET } from './shared'

export function sendUsdcToUserCommand(): Command {
  return new Command('send-usdc-to-user')
    .description('NTT lock USDC.s back to flow.fogo_sender + close outflight Flow (withdraw leg, step 4 — terminal)')
    .requiredOption('--fogo-tx <signature>', 'FOGO tx signature that emitted the burn VAA')
    .option('--vaa <hex>', 'Override Wormholescan lookup with raw signed VAA bytes (hex)')
    .option('--ntt-program <pubkey>', `NTT USDC.s manager program id (default: ${NTT_USDC_PROGRAM_ID.toBase58()})`)
    .option('--onyc-ntt-program <pubkey>', `NTT ONyc manager program id used to resolve the inbox-item (default: ${NTT_ONYC_PROGRAM_ID.toBase58()})`)
    .option('--wormholescan-url <url>', `Wormholescan REST base URL [default: ${DEFAULT_WORMHOLESCAN_URL}]`)
    .option('--confirm', 'Actually broadcast the transaction (default: dry-run)')
    .action(async (opts: {
      fogoTx: string
      vaa?: string
      nttProgram?: string
      onycNttProgram?: string
      wormholescanUrl?: string
      confirm?: boolean
    }) => {
      const { connection, keypair, client } = useContext()
      const nttProgram = opts.nttProgram ? new PublicKey(opts.nttProgram) : NTT_USDC_PROGRAM_ID
      const onycNttProgram = opts.onycNttProgram ? new PublicKey(opts.onycNttProgram) : NTT_ONYC_PROGRAM_ID

      const vaaBytes = await fetchVaaBytes({ fogoTx: opts.fogoTx, vaaHex: opts.vaa, wormholescanUrl: opts.wormholescanUrl })
      // Inbox-item PDA is keyed under the ONyc program (the burn manager).
      const resolved = resolveNttVaa({ vaaBytes, nttProgramId: onycNttProgram })

      const flow = await client.fetchOutflightFlow(resolved.nttInboxItem).catch(() => null)
      if (!flow) {
        throw new Error(`No outflight Flow for inbox-item ${resolved.nttInboxItem.toBase58()}.`)
      }
      const flowStatus = describeStatus(flow.status)
      if (flowStatus !== 'Swapped') {
        throw new Error(`Outflight Flow status is ${flowStatus}, expected Swapped (synthetic: WithdrawSwapped).`)
      }

      // FOGO peer must be registered on USDC NTT manager.
      const [fogoPeerPda] = findNttPeerPda(FOGO_WORMHOLE_CHAIN_ID, nttProgram)
      const peerInfo = await connection.getAccountInfo(fogoPeerPda).catch(() => null)
      if (!peerInfo) {
        throw new Error(`FOGO peer not registered on USDC NTT manager (${fogoPeerPda.toBase58()}).`)
      }

      const cfg = await client.fetchConfig()
      const usdcMint = cfg.baseMint as PublicKey

      const flowRecipient = flow.recipient.toBytes()
      const flowAmount = BigInt(flow.amount.toString())
      const outboxItem = Keypair.generate()

      // Lamport top-ups for relayer_authority + session_authority,
      // mirror of `lock-onyc` since both use NTT outbound transfer_lock.
      const argsHash = nttTransferArgsHash({
        amount: flowAmount,
        recipientChain: FOGO_WORMHOLE_CHAIN_ID,
        recipientAddress: flowRecipient,
        shouldQueue: false,
      })
      const [relayerAuthorityPda] = findAuthorityPda(client.program.programId)
      const [sessionAuthorityPda] = findSessionAuthorityPda(relayerAuthorityPda, argsHash, nttProgram)
      const [relayerAuthInfo, sessionAuthInfo] = await Promise.all([
        connection.getAccountInfo(relayerAuthorityPda).catch(() => null),
        connection.getAccountInfo(sessionAuthorityPda).catch(() => null),
      ])
      const RELAYER_AUTH_TOPUP = 3_000_000n
      const SESSION_AUTH_TOPUP = 2_000_000n
      const computeTopUp = (existing: number | undefined, target: bigint): bigint => {
        const e = BigInt(existing ?? 0)
        return e >= target ? 0n : target - e
      }
      const relayerTopUp = computeTopUp(relayerAuthInfo?.lamports, RELAYER_AUTH_TOPUP)
      const sessionTopUp = computeTopUp(sessionAuthInfo?.lamports, SESSION_AUTH_TOPUP)
      const fundIxs: TransactionInstruction[] = []
      if (relayerTopUp > 0n) {
        fundIxs.push(SystemProgram.transfer({ fromPubkey: keypair.publicKey, toPubkey: relayerAuthorityPda, lamports: Number(relayerTopUp) }))
      }
      if (sessionTopUp > 0n) {
        fundIxs.push(SystemProgram.transfer({ fromPubkey: keypair.publicKey, toPubkey: sessionAuthorityPda, lamports: Number(sessionTopUp) }))
      }

      console.log(chalk.cyan('send-usdc-to-user plan'))
      console.log(chalk.dim(`  payer (signer):         ${keypair.publicKey.toBase58()}`))
      console.log(chalk.dim(`  usdcMint:               ${usdcMint.toBase58()}`))
      console.log(chalk.dim(`  nttProgram (USDC):      ${nttProgram.toBase58()}`))
      console.log(chalk.dim(`  nttInboxItem (ONyc):    ${resolved.nttInboxItem.toBase58()}`))
      console.log(chalk.dim(`  flow.amount (net):      ${flowAmount.toString()}`))
      console.log(chalk.dim(`  flow.recipient:         ${Buffer.from(flowRecipient).toString('hex')}`))
      console.log(chalk.dim(`  rentDestination:        ${(flow.payer as PublicKey).toBase58()} (= flow.payer)`))
      console.log(chalk.dim(`  outboxItem:             ${outboxItem.publicKey.toBase58()} (ephemeral)`))
      console.log(chalk.dim(`  relayerAuthority topUp: ${relayerTopUp} lamports`))
      console.log(chalk.dim(`  sessionAuthority topUp: ${sessionTopUp} lamports`))

      if (!opts.confirm) {
        console.log()
        console.log(chalk.yellow('dry-run only. Re-run with --confirm to broadcast.'))
        console.log(chalk.dim('  NOTE: the outboxItem keypair above is regenerated on the next run.'))
        return
      }

      console.log()
      const usdcNtt = makeSolanaNtt({
        connection,
        manager: nttProgram,
        token: usdcMint,
        wormholeCore: WORMHOLE_CORE_MAINNET,
        version: DEFAULT_NTT_VERSION,
      })
      const release = await deriveLockOnycReleaseAccounts(
        usdcNtt,
        keypair.publicKey,
        outboxItem.publicKey,
      )
      const sig = await runTx(() =>
        client
          .send({
            payer: keypair.publicKey,
            direction: { withdraw: {} },
            baseMint: usdcMint,
            assetMint: cfg.assetMint as PublicKey,
            nttInboxItem: resolved.nttInboxItem,
            rentDestination: flow.payer as PublicKey,
            flowAmount,
            flowRecipient,
            outboxItem: outboxItem.publicKey,
            release,
          })
          .preInstructions(fundIxs)
          .signers([outboxItem])
          .rpc(),
      )
      console.log(chalk.green('send-usdc-to-user landed'))
      console.log(chalk.dim(`  tx: ${sig}`))
    })
}
