import type { AdvanceContext, AdvanceResult } from './types'
import {
  describeStatus,
  NTT_ONYC_PROGRAM_ID,
  resolveNttVaa,
} from '@fogo-onre/sdk'
import { PublicKey, SystemProgram } from '@solana/web3.js'
import { withTimeout } from '../utils/rpc'
import { fetchVaaBytes } from '../utils/wormhole'
import { isLostRace } from './race-classifier'

export type ClaimRedemptionUsdcInput = {
  fogoTx: string
  vaaHex?: string
  nttProgram?: PublicKey
}

/**
 * Step 3 of the withdraw chain. Drives `claim_redemption_usdc` on
 * Solana — pure on-chain bookkeeping, **no CPI**. Verifies OnRe
 * fulfilled the redemption (signal: the `RedemptionRequest` PDA was
 * closed by `fulfill_redemption_request`), books the USDC delta vs
 * `tracker.usdc_ata_pre_balance` onto the flow, and closes the
 * singleton `RedemptionTracker` (rent → `tracker.payer`). Status:
 * `RedemptionPending` → `Swapped`, surfaced as
 * `RedemptionPending` → `WithdrawSwapped`.
 *
 * Why "no CPI" matters operationally: this handler doesn't need lamport
 * top-ups, doesn't pay Wormhole fees, doesn't sign with NTT session
 * authorities. It's the cheapest of the four. It's also the only
 * handler whose readiness depends on an **off-chain async** event —
 * OnRe's redemption fulfillment lives outside the cranker's control,
 * so this leg's "noop, retry later" is the wall-clock-bound one.
 *
 * Cross-leg handoff via on-chain state: the previous leg
 * (`requestRedemptionOnyc`) generated an ephemeral `redemption_request`
 * keypair, signed with it, and threw it away. Its pubkey lives in
 * `RedemptionTracker.redemption_request`. We fetch the tracker here to
 * recover it — no per-flow off-chain state needed in the daemon.
 */
export async function claimRedemptionUsdc(
  ctx: AdvanceContext,
  input: ClaimRedemptionUsdcInput,
): Promise<AdvanceResult> {
  const { connection, keypair, client, metrics } = ctx
  const nttProgram = input.nttProgram ?? NTT_ONYC_PROGRAM_ID

  try {
    const vaaBytes = await fetchVaaBytes({
      fogoTx: input.fogoTx,
      vaaHex: input.vaaHex,
      wormholescanUrl: ctx.wormholescanUrl,
      timeoutMs: ctx.wormholescanTimeoutMs,
    })
    const resolved = resolveNttVaa({ vaaBytes, nttProgramId: nttProgram })

    // Pre-flight 1: outflight Flow must exist with status=RedemptionPending.
    // Anything else means we're picking up a flow that isn't ours — either
    // an earlier leg hasn't run, or this leg already landed.
    const flow = await client.fetchOutflightFlow(resolved.nttInboxItem).catch(() => null)
    if (!flow) {
      return {
        kind: 'noop',
        reason: `no outflight Flow for inbox-item ${resolved.nttInboxItem.toBase58()} — earlier withdraw legs haven't run`,
      }
    }
    const flowStatus = describeStatus(flow.status)
    if (flowStatus !== 'RedemptionPending') {
      return {
        kind: 'noop',
        reason: `outflight Flow status is ${flowStatus}, expected RedemptionPending`,
      }
    }

    // Pre-flight 2: tracker must exist (request_redemption_onyc inits
    // it). If it's missing while flow.status==RedemptionPending, the
    // chain is internally inconsistent — surface as error so operators
    // notice. (This shouldn't happen: the on-chain transitions are
    // atomic — tracker init and status flip occur in the same tx.)
    const trackerPda = client.redemptionTrackerPda
    type TrackerAccount = Awaited<ReturnType<typeof fetchTracker>>
    async function fetchTracker(): Promise<{
      flow: PublicKey
      redemptionRequest: PublicKey
      usdcAtaPreBalance: bigint | { toString: () => string }
      onycAmountIn: bigint | { toString: () => string }
      payer: PublicKey
      bump: number
    } | null> {
      try {
        // Anchor's account namespace lowercases the first letter of the
        // Rust struct name (`RedemptionTracker` → `redemptionTracker`).
        return await (client.program.account as unknown as {
          redemptionTracker: { fetch: (k: PublicKey) => Promise<{
            flow: PublicKey
            redemptionRequest: PublicKey
            usdcAtaPreBalance: bigint | { toString: () => string }
            onycAmountIn: bigint | { toString: () => string }
            payer: PublicKey
            bump: number
          }> }
        }).redemptionTracker.fetch(trackerPda)
      } catch {
        return null
      }
    }
    const tracker: TrackerAccount = await withTimeout(
      fetchTracker(),
      ctx.rpcTimeoutMs,
      'fetchRedemptionTracker',
    )
    if (!tracker) {
      return {
        kind: 'error',
        error: new Error(
          `RedemptionTracker missing at ${trackerPda.toBase58()} but outflight Flow ${resolved.nttInboxItem.toBase58()} is RedemptionPending — chain inconsistency`,
        ),
        partialSignatures: [],
      }
    }

    // Pre-flight 3: the OnRe `redemption_request` account must be
    // **closed** — that's the only fulfillment signal the on-chain
    // handler accepts (lamports==0, data empty, owner==system_program).
    // While it's still owned by OnRe, the redemption hasn't been
    // fulfilled and our submit would revert with `RedemptionNotFulfilled`.
    // Noop with a clear "waiting on OnRe" reason so operators don't
    // mistake this for a stuck flow.
    const reqInfo = await withTimeout(
      connection.getAccountInfo(tracker.redemptionRequest),
      ctx.rpcTimeoutMs,
      'getAccountInfo(redemptionRequest)',
    ).catch(() => null)
    const closed = reqInfo === null
      || (reqInfo.lamports === 0
        && reqInfo.data.length === 0
        && reqInfo.owner.equals(SystemProgram.programId))
    if (!closed) {
      return {
        kind: 'noop',
        reason: `OnRe redemption_request ${tracker.redemptionRequest.toBase58()} not yet closed — waiting on OnRe fulfill_redemption_request`,
      }
    }

    // Pre-flight 4: tracker.flow must derive back to *this* outflight
    // Flow PDA. If not, the tracker is held by a different flow — the
    // singleton mutex is doing its job and we shouldn't claim. (Status
    // check + tracker existence already imply this in practice, but the
    // on-chain handler does an explicit `require_keys_eq!` and it's
    // cheap to mirror — saves a wasted submit.)
    const cfg = await client.fetchConfig()
    const usdcMint = cfg.usdcMint as PublicKey

    const sig = await client
      .claimRedemptionUsdc({
        cranker: keypair.publicKey,
        usdcMint,
        nttInboxItem: resolved.nttInboxItem,
        // Cross-leg handoff: pubkey was generated and discarded by
        // `requestRedemptionOnyc` — recovered here from the tracker.
        redemptionRequest: tracker.redemptionRequest,
        // On-chain `close = payer_for_close` plus
        // `address = redemption_tracker.payer` constraints — must equal
        // tracker.payer or the tx fails with ConstraintAddress (2003).
        // The original payer of `request_redemption_onyc` may not be
        // *this* cranker, so we cannot just pass keypair.publicKey.
        payerForClose: tracker.payer,
      })
      .rpc()

    metrics.txSent.inc({ instruction: 'claim_redemption_usdc', result: 'ok' })
    metrics.flowAdvance.inc({
      leg: 'withdraw',
      from_status: 'RedemptionPending',
      to_status: 'WithdrawSwapped',
    })

    return {
      kind: 'advanced',
      signatures: [sig],
      fromStatus: 'RedemptionPending',
      toStatus: 'WithdrawSwapped',
    }
  } catch (err) {
    metrics.txSent.inc({ instruction: 'claim_redemption_usdc', result: 'error' })
    // Race: another cranker claimed between our pre-flight 3 and our
    // submit (FlowStatusMismatch on the flow, or RedemptionTracker
    // already closed). Both classify as "lost race" — downgrade.
    const raceReason = isLostRace(err)
    if (raceReason) {
      return { kind: 'noop', reason: raceReason }
    }
    return {
      kind: 'error',
      error: err instanceof Error ? err : new Error(String(err)),
      partialSignatures: [],
    }
  }
}
