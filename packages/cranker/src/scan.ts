import type { PublicKey } from '@solana/web3.js'
import type { AdvanceContext, AdvanceResult } from './advance/types'
import * as advance from './advance'
import { errorFields } from './log'
import { withTimeout } from './rpc'

export type AdvanceFns = {
  claimUsdc: typeof advance.claimUsdc
  swapUsdcToOnyc: typeof advance.swapUsdcToOnyc
  lockOnyc: typeof advance.lockOnyc
  unlockOnyc: typeof advance.unlockOnyc
  requestRedemption: typeof advance.requestRedemption
  claimRedemption: typeof advance.claimRedemption
  sendUsdcToUser: typeof advance.sendUsdcToUser
}

export type ScannedFlow = {
  pubkey: PublicKey
  /** Synthetic status: 'Pending' for VAAs without a Flow yet, else the Flow's on-chain status. */
  status: string
  /** Source-chain tx signature; may be empty if unknown. */
  fogoTx: string
  /** Pre-fetched VAA bytes hex-encoded — preferred over fogoTx to avoid a second Wormholescan round-trip. */
  vaaHex?: string
}

export type EnumerateFlowsFn = (ctx: AdvanceContext) => Promise<ScannedFlow[]>

export type ScanOptions = {
  maxConcurrentAdvances: number
  rpcTimeoutMs: number
  enumerateFlows?: EnumerateFlowsFn
  advanceFns?: AdvanceFns
  /** Optional skip counter — incremented when a Flow has a status the cranker cannot currently advance (e.g. withdraw-leg statuses gated on ONyc deploy). */
  skipCounter?: { inc: (labels: { reason: string }) => void }
  /**
   * Cross-iteration dedup state for `flow advance failed` warnings.
   * Without this, an unrecoverable flow re-emits the same warning every
   * scan interval forever (e.g. a deposit whose VAA recipient encoding
   * is broken — see "cannot derive userWallet"). With it, the first
   * (flow, error-fingerprint) sighting logs at warn; repeats log at debug.
   *
   * Owned by the daemon (one Map per process); passed in so this module
   * stays free of module-level mutable state and stays unit-testable.
   */
  seenAdvanceErrors?: Map<string, string>
}

const DEFAULT_ADVANCE_FNS: AdvanceFns = {
  claimUsdc: advance.claimUsdc,
  swapUsdcToOnyc: advance.swapUsdcToOnyc,
  lockOnyc: advance.lockOnyc,
  unlockOnyc: advance.unlockOnyc,
  requestRedemption: advance.requestRedemption,
  claimRedemption: advance.claimRedemption,
  sendUsdcToUser: advance.sendUsdcToUser,
}

const defaultEnumerateFlows: EnumerateFlowsFn = async () => []

export async function scanAndAdvance(
  ctx: AdvanceContext,
  opts: ScanOptions,
): Promise<void> {
  if (ctx.abortSignal.aborted) {
    throw new Error('scan aborted before start')
  }

  const fns = opts.advanceFns ?? DEFAULT_ADVANCE_FNS
  const enumerate = opts.enumerateFlows ?? defaultEnumerateFlows

  const flows = await withTimeout(
    enumerate(ctx),
    opts.rpcTimeoutMs,
    'enumerateFlows',
  )

  ctx.log.debug('flows enumerated', { total: flows.length })

  const tasks: Array<() => Promise<AdvanceResult>> = []
  for (const flow of flows) {
    const dispatch = pickAdvanceForStatus(flow.status, fns)
    if (!dispatch) {
      ctx.log.debug('flow skipped', {
        flow: flow.pubkey.toBase58(),
        status: flow.status || 'unknown',
      })
      opts.skipCounter?.inc({ reason: flow.status || 'unknown' })
      continue
    }
    const flowKey = flow.pubkey.toBase58()
    tasks.push(async () => {
      ctx.log.debug('dispatching advance', { flow: flowKey, status: flow.status })
      const result = await dispatch(ctx, { fogoTx: flow.fogoTx, vaaHex: flow.vaaHex })
      logAdvanceResult(ctx, flowKey, flow.status, result, opts.seenAdvanceErrors)
      return result
    })
  }

  await runBounded(tasks, opts.maxConcurrentAdvances, ctx.abortSignal, ctx.log)
}

function logAdvanceResult(
  ctx: AdvanceContext,
  flow: string,
  fromStatus: string,
  result: AdvanceResult,
  seenErrors?: Map<string, string>,
): void {
  switch (result.kind) {
    case 'advanced':
      ctx.log.info('flow advanced', {
        flow,
        from: result.fromStatus,
        to: result.toStatus,
        signatures: result.signatures,
      })
      // A successful advance clears the dedup memo: if the flow ever
      // fails again with the same error, we want to hear about it again.
      seenErrors?.delete(flow)
      return
    case 'noop':
      // Routine: another cranker advanced first, or pre-flight rejected.
      ctx.log.debug('flow noop', { flow, status: fromStatus, reason: result.reason })
      return
    case 'error': {
      // Per-flow failures are warnings, not errors — the next scan retries.
      // The scan-loop-level `error` log is reserved for whole-iteration failures.
      // Dedup: same (flow, error-message) pair downgrades to debug after the
      // first sighting in this process. Different error → re-emit at warn.
      const fingerprint = errorFingerprint(result.error)
      const previously = seenErrors?.get(flow)
      const isRepeat = previously === fingerprint
      const fields = {
        flow,
        status: fromStatus,
        partialSignatures: result.partialSignatures,
        ...errorFields(result.error),
      }
      if (isRepeat) {
        ctx.log.debug('flow advance failed (repeat)', fields)
      } else {
        ctx.log.warn('flow advance failed', fields)
        seenErrors?.set(flow, fingerprint)
      }
    }
  }
}

/**
 * Stable identity for an error: its message text. We deliberately don't
 * include stack frames (line numbers churn across builds) or pubkeys
 * (already part of `flow`). Two failures with identical messages on the
 * same flow are treated as the same recurring problem.
 */
function errorFingerprint(err: Error): string {
  return err.message
}

type DispatchFn = (
  ctx: AdvanceContext,
  input: { fogoTx: string, vaaHex?: string },
) => Promise<AdvanceResult>

function pickAdvanceForStatus(status: string, fns: AdvanceFns): DispatchFn | undefined {
  switch (status) {
    case 'Pending':
      return fns.claimUsdc
    case 'Claimed':
      return fns.swapUsdcToOnyc
    case 'Swapped':
      return fns.lockOnyc
    // Withdraw-chain dispatches added when those advance fns are implemented:
    //   case 'RedemptionPending': return fns.claimRedemption
    //   case 'RedemptionSettled': return fns.sendUsdcToUser
    default:
      return undefined
  }
}

async function runBounded<T>(
  tasks: Array<() => Promise<T>>,
  concurrency: number,
  signal: AbortSignal,
  log?: { warn: (msg: string, fields?: Record<string, unknown>) => void },
): Promise<void> {
  let i = 0
  let aborted = false
  const workers = Array.from({ length: concurrency }, async () => {
    while (i < tasks.length) {
      if (signal.aborted) {
        aborted = true
        return
      }
      const idx = i++
      // Advance fns are contractually no-throw (they map errors into AdvanceResult.error).
      // A throw here is a bug; surface it instead of swallowing.
      await tasks[idx]().catch((err) => {
        log?.warn('runBounded task threw (advance contract violation)', errorFields(err))
      })
    }
  })
  await Promise.all(workers)
  if (aborted) {
    throw new Error('scan aborted mid-flight')
  }
}
