import { describeStatus, findAuthorityPda, findInboxRateLimitPda, findNttPeerPda, findRegisteredTransceiverPda, FOGO_WORMHOLE_CHAIN_ID, NTT_ONYC_PROGRAM_ID, NTT_USDC_PROGRAM_ID, resolveNttVaa } from '@fogo-onre/sdk'
import { PublicKey } from '@solana/web3.js'
import chalk from 'chalk'
import { Command } from 'commander'
import { useContext } from '../../context'
import { DEFAULT_WORMHOLESCAN_URL, fetchVaaBytes } from './shared'

// `diagnose` is the operator-facing "where is this flow stuck and what
// do I run next?" command — a read-only report mirroring every
// pre-flight gate inside `lock_onyc` (deposit-leg step 3). No
// signatures spent, no chain mutations.
//
// Gates checked (each must pass for `lock_onyc` to dispatch):
//   1. NTT ONyc manager id is not the USDC manager placeholder
//   2. FOGO peer registered on the Solana ONyc NTT manager
//   3. FOGO inbox-rate-limit PDA initialized on the same manager
//   4. `registered_transceiver` PDA initialized on the same manager
//   5. `relayer_authority` PDA has at least 3M lamports (NTT's
//      OutboxItem rent debit floor — silently underflows otherwise)
export function diagnoseCommand(): Command {
  return new Command('diagnose')
    .description('Read-only end-to-end report of why a deposit flow is stalled and exactly what to run next')
    .requiredOption('--fogo-tx <signature>', 'FOGO tx signature that emitted the bridge VAA')
    .option('--vaa <hex>', 'Override Wormholescan lookup with raw signed VAA bytes (hex)')
    .option('--ntt-program <pubkey>', `NTT USDC.s manager program id (default: ${NTT_USDC_PROGRAM_ID.toBase58()})`)
    .option('--wormholescan-url <url>', `Wormholescan REST base URL [default: ${DEFAULT_WORMHOLESCAN_URL}]`)
    .action(async (opts: {
      fogoTx: string
      vaa?: string
      nttProgram?: string
      wormholescanUrl?: string
    }) => {
      const { connection, client } = useContext()
      const nttProgram = opts.nttProgram ? new PublicKey(opts.nttProgram) : NTT_USDC_PROGRAM_ID

      // Mirror of lock-onyc.ts: NTT debits OutboxItem rent from
      // relayer_authority; target = debit + rent-exempt + headroom = 3M.
      const RELAYER_AUTH_TOPUP_LAMPORTS = 3_000_000n

      let vaaBytes: Uint8Array | null = null
      try {
        vaaBytes = await fetchVaaBytes({
          fogoTx: opts.fogoTx,
          vaaHex: opts.vaa,
          wormholescanUrl: opts.wormholescanUrl,
        })
      } catch (err) {
        // VAA fetch failure is itself a diagnosis: guardians haven't
        // signed VAA #1 yet, or the FOGO tx didn't emit a Wormhole msg.
        // Treat it as terminal-for-this-report so the operator sees a
        // clear "VAA #1 missing" signal instead of an unhandled throw.
        console.log(chalk.red('VAA #1 not retrievable'))
        console.log(chalk.dim(`  cause: ${err instanceof Error ? err.message : String(err)}`))
        console.log()
        console.log(chalk.yellow('Diagnosis: the FOGO burn either has not been observed by guardians yet, or it did not emit a Wormhole message.'))
        console.log(chalk.dim('  - Wait a few seconds and retry — guardian signing typically lands within ~10s of FOGO finality.'))
        console.log(chalk.dim('  - If the retry still fails after 60s, verify the tx actually invoked NTT transfer_burn (check FogoScan).'))
        return
      }

      const resolved = resolveNttVaa({ vaaBytes, nttProgramId: nttProgram })

      console.log(chalk.cyan('VAA #1 (FOGO → Solana, USDC.s)'))
      console.log(chalk.dim(`  emitterChain:           ${resolved.fromChain}`))
      console.log(chalk.dim(`  sequence:               ${resolved.vaa.sequence}`))
      console.log(chalk.dim(`  sender:                 ${resolved.senderOnSource.toBase58()}`))
      console.log(chalk.dim(`  recipient (Solana PDA): ${resolved.recipientOnSolana.toBase58()}`))
      console.log(chalk.dim(`  trimmedAmount:          ${resolved.manager.trimmedAmount} (decimals=${resolved.manager.trimmedDecimals})`))
      console.log(chalk.dim(`  nttInboxItem:           ${resolved.nttInboxItem.toBase58()}`))

      // 1. Has VAA #1 been delivered to NTT on Solana?
      // 2. What does the Flow PDA say (if anything)?
      // Fetch both in parallel — independent RPCs.
      const [inboxItemInfo, inflight] = await Promise.all([
        connection.getAccountInfo(resolved.nttInboxItem).catch(() => null),
        client.fetchInflightFlow(resolved.nttInboxItem).catch(() => null),
      ])
      const claimDone = inboxItemInfo !== null
      const flowExists = inflight !== null
      const flowStatus = inflight ? describeStatus(inflight.status) : '(no Flow PDA)'

      console.log(chalk.cyan('\nSolana side state'))
      console.log(chalk.dim(`  NTT inbox_item:         ${claimDone ? chalk.green('exists ✓') : chalk.yellow('missing — claim_usdc has not run')}`))
      console.log(chalk.dim(`  inflight Flow PDA:      ${flowExists ? chalk.green(`exists (status=${flowStatus})`) : chalk.yellow('(none — either fresh or lock_onyc already closed it)')}`))
      if (inflight) {
        console.log(chalk.dim(`  Flow.amount:            ${inflight.amount.toString()}`))
        console.log(chalk.dim(`  Flow.recipient:         ${inflight.recipient.toBase58()}`))
        console.log(chalk.dim(`  Flow.payer:             ${inflight.payer.toBase58()}`))
      }

      // Pre-flight gates that `lock_onyc` runs every scan. Each is
      // checked even when the Flow PDA isn't `Swapped` yet — the report
      // is more useful when it surfaces deployment problems eagerly,
      // not just at the exact moment they'd block.
      console.log(chalk.cyan('\nlock_onyc pre-flight gates'))

      // Gate 1: ONyc NTT manager not the USDC placeholder.
      const placeholderActive = NTT_ONYC_PROGRAM_ID.equals(NTT_USDC_PROGRAM_ID)
      const gate1Ok = !placeholderActive
      console.log(`  ${gate1Ok ? chalk.green('✓') : chalk.red('✗')} ONyc NTT manager distinct from USDC manager`)
      console.log(chalk.dim(`      NTT_ONYC_PROGRAM_ID = ${NTT_ONYC_PROGRAM_ID.toBase58()}`))
      console.log(chalk.dim(`      NTT_USDC_PROGRAM_ID = ${NTT_USDC_PROGRAM_ID.toBase58()}`))
      if (!gate1Ok) {
        console.log(chalk.dim(chalk.red('      → SDK constants still hold the placeholder — rebuild SDK with real ONyc manager id')))
      }

      // Gates 2 & 3: FOGO peer + inbox_rate_limit on ONyc NTT manager.
      // Fetch in parallel — both gate `transfer_lock` independently.
      const [fogoPeerPda] = findNttPeerPda(FOGO_WORMHOLE_CHAIN_ID, NTT_ONYC_PROGRAM_ID)
      const [fogoInboxRateLimitPda] = findInboxRateLimitPda(FOGO_WORMHOLE_CHAIN_ID, NTT_ONYC_PROGRAM_ID)
      // Gate 4: registered_transceiver PDA. The OnRe ONyc deployment
      // uses bundled-transceiver mode (transceiver == manager program),
      // so seed = ["registered_transceiver", manager_pubkey] under the
      // same manager. Mirrors `lock-onyc.ts:122-128`.
      const [registeredTransceiverPda] = findRegisteredTransceiverPda(
        NTT_ONYC_PROGRAM_ID,
        NTT_ONYC_PROGRAM_ID,
      )
      // Gate 5: relayer_authority lamports — NTT debits OutboxItem rent
      // via invoke_signed; if the PDA can't cover the debit + rent-exempt
      // floor, the CPI reverts with `Transfer: insufficient lamports`.
      const [relayerAuthorityPda] = findAuthorityPda(client.program.programId)
      const [peerInfo, inboxRateLimitInfo, transceiverInfo, relayerAuthInfo] = await Promise.all([
        connection.getAccountInfo(fogoPeerPda).catch(() => null),
        connection.getAccountInfo(fogoInboxRateLimitPda).catch(() => null),
        connection.getAccountInfo(registeredTransceiverPda).catch(() => null),
        connection.getAccountInfo(relayerAuthorityPda).catch(() => null),
      ])

      const gate2Ok = peerInfo !== null
      console.log(`  ${gate2Ok ? chalk.green('✓') : chalk.red('✗')} FOGO peer registered on ONyc NTT manager`)
      console.log(chalk.dim(`      ${fogoPeerPda.toBase58()}`))
      if (!gate2Ok) {
        console.log(chalk.dim(chalk.red(`      → operator must run NTT set-peer for FOGO chain ${FOGO_WORMHOLE_CHAIN_ID} on the ONyc NTT manager`)))
      }

      const gate3Ok = inboxRateLimitInfo !== null
      console.log(`  ${gate3Ok ? chalk.green('✓') : chalk.red('✗')} FOGO inbox_rate_limit PDA initialized`)
      console.log(chalk.dim(`      ${fogoInboxRateLimitPda.toBase58()}`))
      if (!gate3Ok) {
        console.log(chalk.dim(chalk.red(`      → typically initialized by set-peer; if missing alongside peer it confirms set-peer was never run for FOGO`)))
      }

      const gate4Ok = transceiverInfo !== null
      console.log(`  ${gate4Ok ? chalk.green('✓') : chalk.red('✗')} registered_transceiver PDA on ONyc NTT manager`)
      console.log(chalk.dim(`      ${registeredTransceiverPda.toBase58()}`))
      if (!gate4Ok) {
        console.log(chalk.dim(chalk.red('      → operator must run NTT register-transceiver on the ONyc NTT manager')))
      }

      const relayerAuthLamports = BigInt(relayerAuthInfo?.lamports ?? 0)
      const gate5Ok = relayerAuthLamports >= RELAYER_AUTH_TOPUP_LAMPORTS
      console.log(`  ${gate5Ok ? chalk.green('✓') : chalk.yellow('!')} relayer_authority PDA funded for OutboxItem rent`)
      console.log(chalk.dim(`      ${relayerAuthorityPda.toBase58()} balance=${relayerAuthLamports.toString()} lamports (target ≥ ${RELAYER_AUTH_TOPUP_LAMPORTS.toString()})`))
      if (!gate5Ok) {
        console.log(chalk.dim(chalk.yellow('      → not strictly fatal: every cranker invocation tops this up to 3M before transfer_lock, so cli/daemon recover automatically')))
      }

      const allGatesOk = gate1Ok && gate2Ok && gate3Ok && gate4Ok

      // Decision tree — turn the gathered state into a single actionable
      // recommendation. Branches are ordered by what the operator would
      // do first, not by chain order.
      console.log(chalk.cyan('\nDiagnosis'))
      if (!claimDone && !flowExists) {
        console.log(chalk.yellow('  Fresh deposit — no Solana side work has run yet.'))
        console.log(chalk.green(`  Next action:  cranker advance --fogo-tx ${opts.fogoTx} --confirm`))
        console.log(chalk.dim('  (orchestrates claim_usdc + swap_usdc_to_onyc + lock_onyc in one or two atomic txs)'))
        return
      }
      if (flowExists && flowStatus === 'Received') {
        console.log(chalk.yellow('  claim_usdc landed; swap_usdc_to_onyc has not run.'))
        console.log(chalk.green(`  Next action:  cranker advance --fogo-tx ${opts.fogoTx} --confirm`))
        console.log(chalk.dim('  (advance is idempotent — re-running picks up exactly where chain state left off)'))
        return
      }
      if (flowExists && flowStatus === 'Swapped') {
        if (!allGatesOk) {
          console.log(chalk.red('  swap_usdc_to_onyc landed, but lock_onyc cannot dispatch — one or more deployment gates above are failing.'))
          console.log(chalk.dim('  USDC.s value is now held on Solana as ONyc in the relayer/OnRe ATA. Funds are safe but pinned until the gates are fixed.'))
          console.log(chalk.green('  Next action:  fix the ✗ gates above (operator/governance action on NTT manager), then `cranker advance --confirm` to resume.'))
          return
        }
        console.log(chalk.yellow('  Ready for lock_onyc — all pre-flight gates pass.'))
        console.log(chalk.green(`  Next action:  cranker advance --fogo-tx ${opts.fogoTx} --confirm`))
        console.log(chalk.dim('  (lock_onyc emits VAA #2 atomically; the cranker daemon\'s `solana-onyc-to-fogo` bridge leg then redeems it on FOGO)'))
        return
      }
      if (claimDone && !flowExists) {
        // Two sub-cases under this branch:
        //  a) lock_onyc fired and VAA #2 is in flight / FOGO-side redeem
        //     pending — the daemon's bridge leg handles this automatically
        //     but the operator can force it with `redeem-fogo --vaa <hex>`.
        //  b) claim_usdc ran but swap+lock then closed the flow (would be
        //     unusual on the deposit chain — rules it out implicitly).
        console.log(chalk.green('  Solana side complete: lock_onyc already closed the Flow PDA and emitted VAA #2.'))
        console.log(chalk.yellow('  Remaining: FOGO-side NTT redeem must consume VAA #2 and mint ONyc into the user wallet.'))
        console.log()
        console.log(chalk.cyan('  How to verify / fix:'))
        console.log(chalk.dim(`    1. Look up VAA #2 on Wormholescan from the Solana ONyc emitter`))
        console.log(chalk.dim(`       (emitter address = NTT_ONYC_PROGRAM_ID '${NTT_ONYC_PROGRAM_ID.toBase58()}' wrapped to a Wormhole-format 32-byte hex)`))
        console.log(chalk.dim(`       Watch your bridge sequence; sequences are monotonic per emitter.`))
        console.log(chalk.dim(`    2. If VAA #2 status is 'completed', the redeem has already landed on FOGO — confirm by checking the user's ONyc ATA balance.`))
        console.log(chalk.dim(`    3. If VAA #2 is 'published' but not 'completed', the FOGO redeem is pending. Force it:`))
        console.log(chalk.green(`         cranker redeem-fogo --vaa <hex of signed VAA #2> --confirm`))
        console.log(chalk.dim(`    4. If VAA #2 doesn't exist on Wormholescan yet, guardians haven't observed lock_onyc's emit — wait ~10s or check Solana for the lock_onyc tx.`))
        return
      }
      console.log(chalk.red('  Unexpected state combination — please report this output to engineering.'))
      console.log(chalk.dim(`    claimDone=${claimDone} flowExists=${flowExists} flowStatus=${flowStatus}`))
    })
}
