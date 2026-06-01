import { describeStatus, findAuthorityPda, findInboxRateLimitPda, findInflightFlowPda, findNttPeerPda, findSessionAuthorityPda, FOGO_WORMHOLE_CHAIN_ID, NTT_ONYC_PROGRAM_ID, NTT_USDC_PROGRAM_ID, nttTransferArgsHash, ONYC_MINT, resolveNttVaa } from '@fogo-onre/sdk'
import { Keypair, PublicKey, SystemProgram } from '@solana/web3.js'
import chalk from 'chalk'
import { Command } from 'commander'
import { runTx, useContext } from '../../context'
import { DEFAULT_NTT_VERSION, DEFAULT_WORMHOLESCAN_URL, deriveLockOnycReleaseAccounts, fetchVaaBytes, makeSolanaNtt, WORMHOLE_CORE_MAINNET } from './shared'

export function lockOnycCommand(): Command {
  return new Command('lock-onyc')
    .description('Lock ONyc via NTT, sending ONyc back to FOGO sender (deposit leg, step 3)')
    .requiredOption('--fogo-tx <signature>', 'FOGO tx signature that emitted the bridge VAA')
    .option('--vaa <hex>', 'Override Wormholescan lookup with raw signed VAA bytes (hex)')
    .option('--onyc-mint <pubkey>', `ONyc mint (default from on-chain RelayerConfig, fallback ${ONYC_MINT.toBase58()})`)
    .option('--ntt-program <pubkey>', `NTT USDC.s manager program id used to resolve VAA (default: ${NTT_USDC_PROGRAM_ID.toBase58()})`)
    .option('--rent-destination <pubkey>', 'Destination for closed Flow PDA rent (default: signer)')
    .option('--wormholescan-url <url>', `Wormholescan REST base URL [default: ${DEFAULT_WORMHOLESCAN_URL}]`)
    .option('--ntt-version <ver>', `NTT IDL version for the ONyc manager (release leg) [default: ${DEFAULT_NTT_VERSION}]`)
    .option('--wormhole-core <pubkey>', `Wormhole Core program id (release leg) [default: ${WORMHOLE_CORE_MAINNET}]`)
    .option('--confirm', 'Actually broadcast the transaction (default: dry-run)')
    .action(async (opts: {
      fogoTx: string
      vaa?: string
      onycMint?: string
      nttProgram?: string
      rentDestination?: string
      wormholescanUrl?: string
      nttVersion?: string
      wormholeCore?: string
      confirm?: boolean
    }) => {
      const { connection, keypair, client } = useContext()
      const nttProgram = opts.nttProgram ? new PublicKey(opts.nttProgram) : NTT_USDC_PROGRAM_ID
      const rentDestination = opts.rentDestination
        ? new PublicKey(opts.rentDestination)
        : keypair.publicKey
      const vaaBytes = await fetchVaaBytes({
        fogoTx: opts.fogoTx,
        vaaHex: opts.vaa,
        wormholescanUrl: opts.wormholescanUrl,
      })
      const resolved = resolveNttVaa({ vaaBytes, nttProgramId: nttProgram })

      // Pre-flight: Flow must exist with status=Swapped.
      const flow = await client.fetchInflightFlow(resolved.nttInboxItem).catch(() => null)
      if (!flow) {
        throw new Error(
          `No inflight Flow PDA for inbox-item ${resolved.nttInboxItem.toBase58()} — `
          + `prior steps haven't run.`,
        )
      }
      const flowStatus = describeStatus(flow.status)
      if (flowStatus !== 'Swapped') {
        throw new Error(
          `Flow status is ${flowStatus}, expected Swapped. Run 'cranker swap-usdc-to-onyc' first, or this step has already landed (Flow would have been closed).`,
        )
      }

      const cfg = await client.fetchConfig()
      const onycMint = opts.onycMint
        ? new PublicKey(opts.onycMint)
        : (cfg.assetMint as PublicKey)

      // The FOGO destination for the ONyc mint comes from the Flow
      // PDA, set by `receive` from the VAA's NTT-message `sender`
      // field. send uses it as the recipient on FOGO.
      const flowRecipient = flow.recipient.toBytes()
      const flowAmount = BigInt(flow.amount.toString())

      // NTT `transfer_lock` requires a fresh outbox-item account each
      // call (unique per outbound message). It's a one-shot keypair
      // signed alongside the cranker — Anchor's `.signers([...])`
      // attaches it. The account is initialized inside the CPI and
      // owned by the NTT program afterward.
      const outboxItem = Keypair.generate()

      // Pre-flight: NTT `transfer_lock` needs a registered `peer` PDA and
      // matching `inbox_rate_limit` PDA on the source-side manager. Missing
      // either reverts with bare `Custom(1)` (no logs) and burns gas + a
      // fresh outbox keypair, so probe both and bail with a clear diagnostic.
      const [fogoPeerPda] = findNttPeerPda(FOGO_WORMHOLE_CHAIN_ID, NTT_ONYC_PROGRAM_ID)
      const [fogoInboxRateLimitPda] = findInboxRateLimitPda(FOGO_WORMHOLE_CHAIN_ID, NTT_ONYC_PROGRAM_ID)
      const [peerInfo, inboxRateLimitInfo] = await Promise.all([
        client.program.provider.connection.getAccountInfo(fogoPeerPda).catch(() => null),
        client.program.provider.connection.getAccountInfo(fogoInboxRateLimitPda).catch(() => null),
      ])
      if (!peerInfo || !inboxRateLimitInfo) {
        const missing: string[] = []
        if (!peerInfo) {
          missing.push(`peer (${fogoPeerPda.toBase58()})`)
        }
        if (!inboxRateLimitInfo) {
          missing.push(`inbox_rate_limit (${fogoInboxRateLimitPda.toBase58()})`)
        }
        throw new Error(
          `FOGO chain (id=${FOGO_WORMHOLE_CHAIN_ID}) is not registered on the ONyc NTT manager `
          + `(${NTT_ONYC_PROGRAM_ID.toBase58()}): missing ${missing.join(' and ')}. `
          + `lock_onyc cannot dispatch until the FOGO ONyc NTT manager is deployed and the `
          + `relayer authority calls 'set_peer' on the Solana ONyc NTT manager. Your Flow PDA `
          + `is safe in status=Swapped — re-run this command once the peer is registered.`,
        )
      }

      const flowRecipientPk = new PublicKey(flowRecipient)

      // NTT debits OutboxItem rent (~1.86M) from relayer_authority via
      // invoke_signed and delegates through session_authority; both start at
      // 0 on mainnet. Target debit + rent-exempt + headroom = 3M to stay
      // robust if the OutboxItem layout grows; session_authority is never
      // debited, so 2M just clears the rent-exempt floor.
      const RELAYER_AUTH_TOPUP = 3_000_000n
      const SESSION_AUTH_TOPUP = 2_000_000n
      const argsHash = nttTransferArgsHash({
        amount: flowAmount,
        recipientChain: FOGO_WORMHOLE_CHAIN_ID,
        recipientAddress: flowRecipient,
        shouldQueue: false,
      })
      const [relayerAuthorityPda] = findAuthorityPda(client.program.programId)
      const [sessionAuthorityPda] = findSessionAuthorityPda(
        relayerAuthorityPda,
        argsHash,
        NTT_ONYC_PROGRAM_ID,
      )
      const conn = client.program.provider.connection
      const [relayerAuthInfo, sessionAuthInfo] = await Promise.all([
        conn.getAccountInfo(relayerAuthorityPda).catch(() => null),
        conn.getAccountInfo(sessionAuthorityPda).catch(() => null),
      ])
      const computeTopUp = (existing: number | undefined, target: bigint): bigint => {
        const e = BigInt(existing ?? 0)
        return e >= target ? 0n : target - e
      }
      const relayerTopUp = computeTopUp(relayerAuthInfo?.lamports, RELAYER_AUTH_TOPUP)
      const sessionTopUp = computeTopUp(sessionAuthInfo?.lamports, SESSION_AUTH_TOPUP)
      const fundSessionAuthorityIxs: ReturnType<typeof SystemProgram.transfer>[] = []
      if (relayerTopUp > 0n) {
        fundSessionAuthorityIxs.push(SystemProgram.transfer({
          fromPubkey: keypair.publicKey,
          toPubkey: relayerAuthorityPda,
          lamports: Number(relayerTopUp),
        }))
      }
      if (sessionTopUp > 0n) {
        fundSessionAuthorityIxs.push(SystemProgram.transfer({
          fromPubkey: keypair.publicKey,
          toPubkey: sessionAuthorityPda,
          lamports: Number(sessionTopUp),
        }))
      }
      console.log(chalk.cyan('lock-onyc plan'))
      console.log(chalk.dim(`  payer (signer):         ${keypair.publicKey.toBase58()}`))
      console.log(chalk.dim(`  onycMint:               ${onycMint.toBase58()}`))
      console.log(chalk.dim(`  nttInboxItem:           ${resolved.nttInboxItem.toBase58()}`))
      console.log(chalk.dim(`  inflightFlow:           ${findInflightFlowPda(resolved.nttInboxItem, client.program.programId)[0].toBase58()}`))
      console.log(chalk.dim(`  rentDestination:        ${rentDestination.toBase58()}`))
      console.log(chalk.dim(`  flow.amount:            ${flowAmount.toString()}`))
      console.log(chalk.dim(`  flow.recipient:         ${flowRecipientPk.toBase58()}`))
      console.log(chalk.dim(`  outboxItem (new):       ${outboxItem.publicKey.toBase58()}`))
      console.log(chalk.dim(`  relayerAuthority:       ${relayerAuthorityPda.toBase58()}${relayerTopUp > 0n ? chalk.yellow(` (top-up ${relayerTopUp.toString()} lamports for outbox-item rent)`) : chalk.dim(' (already funded)')}`))
      console.log(chalk.dim(`  sessionAuthority:       ${sessionAuthorityPda.toBase58()}${sessionTopUp > 0n ? chalk.yellow(` (top-up ${sessionTopUp.toString()} lamports)`) : chalk.dim(' (already funded)')}`))

      if (!opts.confirm) {
        console.log()
        console.log(chalk.yellow('dry-run only. Re-run with --confirm to broadcast.'))
        return
      }

      console.log()
      const wormholeCore = opts.wormholeCore ?? WORMHOLE_CORE_MAINNET
      const nttVersion = opts.nttVersion ?? DEFAULT_NTT_VERSION
      const onycNtt = makeSolanaNtt({
        connection,
        manager: NTT_ONYC_PROGRAM_ID,
        token: onycMint,
        wormholeCore,
        version: nttVersion,
      })
      const release = await deriveLockOnycReleaseAccounts(
        onycNtt,
        keypair.publicKey,
        outboxItem.publicKey,
      )

      const sig = await runTx(() =>
        client
          .send({
            payer: keypair.publicKey,
            direction: { deposit: {} },
            baseMint: cfg.baseMint as PublicKey,
            assetMint: onycMint,
            nttInboxItem: resolved.nttInboxItem,
            rentDestination,
            flowAmount,
            flowRecipient,
            outboxItem: outboxItem.publicKey,
            release,
          })
          .preInstructions(fundSessionAuthorityIxs)
          .signers([outboxItem])
          .rpc(),
      )

      console.log(chalk.green('lock-onyc landed — ONyc en route to FOGO'))
      console.log(chalk.dim(`  tx: ${sig}`))
      console.log(chalk.dim(`  outbox: ${outboxItem.publicKey.toBase58()}`))
    })
}
