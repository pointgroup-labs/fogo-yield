import type { AdvanceContext } from '../src/relayer/types'
import type { Logger } from '../src/utils/log'
import { PublicKey } from '@solana/web3.js'
import { describe, expect, it, vi } from 'vitest'
import { scanAndAdvance } from '../src/relayer/scan'
import { silentLogger } from '../src/utils/log'

// Minimal mock context — scanAndAdvance only reads abortSignal + log directly;
// the rest is forwarded to advance fns which we mock entirely.
function makeCtx(abortSignal = new AbortController().signal, log: Logger = silentLogger()): AdvanceContext {
  return {
    abortSignal,
    log,
  } as unknown as AdvanceContext
}

function recordingLogger(): { log: Logger, calls: Array<{ level: string, msg: string }> } {
  const calls: Array<{ level: string, msg: string }> = []
  const mk = (level: string) => (msg: string) => {
    calls.push({ level, msg })
  }
  const self: Logger = {
    debug: mk('debug'),
    info: mk('info'),
    warn: mk('warn'),
    error: mk('error'),
    fatal: mk('fatal'),
    child: () => self,
  }
  return { log: self, calls }
}

const PUBKEY = new PublicKey('11111111111111111111111111111111')

describe('scanAndAdvance', () => {
  it('dispatches receive for Pending flows and skips terminal/unknown', async () => {
    const receive = vi.fn().mockResolvedValue({ kind: 'noop', reason: 'test' })
    const swap = vi.fn().mockResolvedValue({ kind: 'noop', reason: 'test' })
    const send = vi.fn().mockResolvedValue({ kind: 'noop', reason: 'test' })

    await scanAndAdvance(makeCtx(), {
      maxConcurrentAdvances: 4,
      rpcTimeoutMs: 5000,
      enumerateFlows: async () => [
        { pubkey: PUBKEY, status: 'Pending', direction: 'deposit', fogoTx: 'tx-A' },
        { pubkey: PUBKEY, status: 'Closed', direction: 'deposit', fogoTx: 'tx-B' }, // terminal — skipped
        { pubkey: PUBKEY, status: 'Swapped', direction: 'deposit', fogoTx: 'tx-C' },
      ],
      advanceFns: { receive, swap, send },
    })

    expect(receive).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledTimes(1)
    expect(swap).toHaveBeenCalledTimes(0)
  })

  it('dispatches swap for Received flows', async () => {
    const receive = vi.fn()
    const swap = vi.fn().mockResolvedValue({ kind: 'noop', reason: 'test' })
    const send = vi.fn()

    await scanAndAdvance(makeCtx(), {
      maxConcurrentAdvances: 4,
      rpcTimeoutMs: 5000,
      enumerateFlows: async () => [
        { pubkey: PUBKEY, status: 'Received', direction: 'withdraw', fogoTx: 'tx-A' },
      ],
      advanceFns: { receive, swap, send },
    })

    expect(swap).toHaveBeenCalledTimes(1)
    expect(receive).toHaveBeenCalledTimes(0)
    expect(send).toHaveBeenCalledTimes(0)
  })

  it('dispatches send for Swapped flows', async () => {
    const receive = vi.fn()
    const swap = vi.fn()
    const send = vi.fn().mockResolvedValue({ kind: 'noop', reason: 'test' })

    await scanAndAdvance(makeCtx(), {
      maxConcurrentAdvances: 4,
      rpcTimeoutMs: 5000,
      enumerateFlows: async () => [
        { pubkey: PUBKEY, status: 'Swapped', direction: 'withdraw', fogoTx: 'tx-A' },
      ],
      advanceFns: { receive, swap, send },
    })

    expect(send).toHaveBeenCalledTimes(1)
    expect(receive).toHaveBeenCalledTimes(0)
    expect(swap).toHaveBeenCalledTimes(0)
  })

  it('respects maxConcurrentAdvances bound', async () => {
    let inflight = 0
    let maxObserved = 0
    const receive = vi.fn().mockImplementation(async () => {
      inflight++
      maxObserved = Math.max(maxObserved, inflight)
      await new Promise(r => setTimeout(r, 20))
      inflight--
      return { kind: 'noop', reason: 'test' }
    })

    const flows = Array.from({ length: 10 }, (_, i) => ({
      pubkey: PUBKEY,
      status: 'Pending',
      direction: 'deposit' as const,
      fogoTx: `tx-${i}`,
    }))

    await scanAndAdvance(makeCtx(), {
      maxConcurrentAdvances: 2,
      rpcTimeoutMs: 5000,
      enumerateFlows: async () => flows,
      advanceFns: { receive, swap: vi.fn(), send: vi.fn() },
    })

    expect(receive).toHaveBeenCalledTimes(10)
    expect(maxObserved).toBeLessThanOrEqual(2)
  })

  it('honors abortSignal aborted before start', async () => {
    const ac = new AbortController()
    ac.abort()
    await expect(
      scanAndAdvance(makeCtx(ac.signal), {
        maxConcurrentAdvances: 2,
        rpcTimeoutMs: 5000,
        enumerateFlows: async () => [{ pubkey: PUBKEY, status: 'Pending', direction: 'deposit', fogoTx: 'tx-A' }],
        advanceFns: { receive: vi.fn(), swap: vi.fn(), send: vi.fn() },
      }),
    ).rejects.toThrow(/abort/)
  })

  it('dedupes recurring per-flow advance failures: warn once, debug repeats', async () => {
    const recorder = recordingLogger()
    const seenAdvanceErrors = new Map<string, string>()
    const receive = vi.fn().mockResolvedValue({
      kind: 'error',
      error: new Error('cannot derive userWallet'),
      partialSignatures: [],
    })

    const opts = {
      maxConcurrentAdvances: 1,
      rpcTimeoutMs: 5000,
      enumerateFlows: async () => [{ pubkey: PUBKEY, status: 'Pending', direction: 'deposit' as const, fogoTx: 'tx-A' }],
      advanceFns: { receive, swap: vi.fn(), send: vi.fn() },
      seenAdvanceErrors,
    }

    // Three consecutive scans (same flow, same error each time).
    await scanAndAdvance(makeCtx(undefined, recorder.log), opts)
    await scanAndAdvance(makeCtx(undefined, recorder.log), opts)
    await scanAndAdvance(makeCtx(undefined, recorder.log), opts)

    const warns = recorder.calls.filter(c => c.msg === 'flow advance failed')
    const debugs = recorder.calls.filter(c => c.msg === 'flow advance failed (known class)')
    expect(warns).toHaveLength(1) // first sighting only
    expect(debugs).toHaveLength(2) // subsequent repeats
  })

  it('re-emits warn when the error class changes', async () => {
    const recorder = recordingLogger()
    const seenAdvanceErrors = new Map<string, string>()
    let attempt = 0
    const receive = vi.fn().mockImplementation(async () => ({
      kind: 'error' as const,
      error: new Error(attempt++ === 0 ? 'first kind of failure' : 'different failure mode'),
      partialSignatures: [],
    }))

    const opts = {
      maxConcurrentAdvances: 1,
      rpcTimeoutMs: 5000,
      enumerateFlows: async () => [{ pubkey: PUBKEY, status: 'Pending', direction: 'deposit' as const, fogoTx: 'tx-A' }],
      advanceFns: { receive, swap: vi.fn(), send: vi.fn() },
      seenAdvanceErrors,
    }

    await scanAndAdvance(makeCtx(undefined, recorder.log), opts)
    await scanAndAdvance(makeCtx(undefined, recorder.log), opts)

    const warns = recorder.calls.filter(c => c.msg === 'flow advance failed')
    expect(warns).toHaveLength(2) // both sightings warn — different classes
  })

  it('class-level dedup collapses 100 distinct flows w/ pubkey-only message variation into one warn', async () => {
    const recorder = recordingLogger()
    const seenAdvanceErrors = new Map<string, string>()
    // Each flow fails with a message whose only variation is a base58
    // pubkey — exactly the production "cannot derive userWallet for VAA
    // recipient <X>" pattern that motivated class-level dedup.
    const flows = Array.from({ length: 100 }, (_, i) => ({
      pubkey: PUBKEY,
      status: 'Pending',
      direction: 'deposit' as const,
      fogoTx: `tx-${i}`,
    }))
    let i = 0
    const fakePubkeys = Array.from({ length: 100 }, (_, k) =>
      // 32-char base58-shaped strings; errorClass() should redact each.
      // Avoid '0' — not in base58 alphabet, would slip through redaction.
      `Recipient${k.toString().replace(/0/g, '1').padStart(23, 'A')}`)
    const receive = vi.fn().mockImplementation(async () => ({
      kind: 'error' as const,
      error: new Error(`cannot derive userWallet for VAA recipient ${fakePubkeys[i++]}`),
      partialSignatures: [],
    }))

    await scanAndAdvance(makeCtx(undefined, recorder.log), {
      maxConcurrentAdvances: 1,
      rpcTimeoutMs: 5000,
      enumerateFlows: async () => flows,
      advanceFns: { receive, swap: vi.fn(), send: vi.fn() },
      seenAdvanceErrors,
    })

    const warns = recorder.calls.filter(c => c.msg === 'flow advance failed')
    const debugs = recorder.calls.filter(c => c.msg === 'flow advance failed (known class)')
    const rollups = recorder.calls.filter(c => c.msg === 'advance failure class observed')
    expect(warns).toHaveLength(1) // 100 flows → 1 first-sighting warn
    expect(debugs).toHaveLength(99) // remaining 99 demoted to debug
    expect(rollups).toHaveLength(1) // info-rollup at end of iteration
  })

  it('chains legs in-tick: Pending → Received → Swapped → Closed in one task', async () => {
    // The leg-chain optimization: once `receive` returns `advanced`, we
    // don't wait for the next scan tick to dispatch `swap`. We loop on
    // `pickAdvanceForStatus(toStatus)` until a leg fails to advance
    // (noop/error) or the new status has no successor.
    const receive = vi.fn().mockResolvedValue({
      kind: 'advanced',
      signatures: ['sig-receive'],
      fromStatus: 'Pending',
      toStatus: 'Received',
    })
    const swap = vi.fn().mockResolvedValue({
      kind: 'advanced',
      signatures: ['sig-swap'],
      fromStatus: 'Received',
      toStatus: 'Swapped',
    })
    const send = vi.fn().mockResolvedValue({
      kind: 'advanced',
      signatures: ['sig-send'],
      fromStatus: 'Swapped',
      toStatus: 'Closed',
    })

    await scanAndAdvance(makeCtx(), {
      maxConcurrentAdvances: 1,
      rpcTimeoutMs: 5000,
      enumerateFlows: async () => [{ pubkey: PUBKEY, status: 'Pending', direction: 'deposit', fogoTx: 'tx-A' }],
      advanceFns: { receive, swap, send },
    })

    expect(receive).toHaveBeenCalledTimes(1)
    expect(swap).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('stops chain on first non-advanced result (leg 2 noop → leg 3 not called)', async () => {
    const receive = vi.fn().mockResolvedValue({
      kind: 'advanced',
      signatures: ['sig-receive'],
      fromStatus: 'Pending',
      toStatus: 'Received',
    })
    const swap = vi.fn().mockResolvedValue({
      // E.g. another cranker raced us between leg 1 and leg 2.
      kind: 'noop',
      reason: 'Flow already past Received',
    })
    const send = vi.fn()

    await scanAndAdvance(makeCtx(), {
      maxConcurrentAdvances: 1,
      rpcTimeoutMs: 5000,
      enumerateFlows: async () => [{ pubkey: PUBKEY, status: 'Pending', direction: 'deposit', fogoTx: 'tx-A' }],
      advanceFns: { receive, swap, send },
    })

    expect(receive).toHaveBeenCalledTimes(1)
    expect(swap).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledTimes(0)
  })

  it('stops chain on error and skips remaining legs', async () => {
    const receive = vi.fn().mockResolvedValue({
      kind: 'advanced',
      signatures: ['sig-receive'],
      fromStatus: 'Pending',
      toStatus: 'Received',
    })
    const swap = vi.fn().mockResolvedValue({
      kind: 'error',
      error: new Error('OnRe offer expired'),
      partialSignatures: [],
    })
    const send = vi.fn()

    await scanAndAdvance(makeCtx(), {
      maxConcurrentAdvances: 1,
      rpcTimeoutMs: 5000,
      enumerateFlows: async () => [{ pubkey: PUBKEY, status: 'Pending', direction: 'deposit', fogoTx: 'tx-A' }],
      advanceFns: { receive, swap, send },
    })

    expect(receive).toHaveBeenCalledTimes(1)
    expect(swap).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledTimes(0)
  })

  it('aborts chain mid-way when abortSignal fires between legs', async () => {
    const ac = new AbortController()
    const receive = vi.fn().mockImplementation(async () => {
      // Trigger abort during leg 1; the chain loop's pre-leg abort check
      // must short-circuit before leg 2 dispatches. (runBounded itself
      // doesn't re-throw here because the per-task workload completed —
      // the assertion is on the chain not continuing.)
      ac.abort()
      return {
        kind: 'advanced',
        signatures: ['sig-receive'],
        fromStatus: 'Pending',
        toStatus: 'Received',
      }
    })
    const swap = vi.fn()
    const send = vi.fn()

    await scanAndAdvance(makeCtx(ac.signal), {
      maxConcurrentAdvances: 1,
      rpcTimeoutMs: 5000,
      enumerateFlows: async () => [{ pubkey: PUBKEY, status: 'Pending', direction: 'deposit', fogoTx: 'tx-A' }],
      advanceFns: { receive, swap, send },
    })

    expect(receive).toHaveBeenCalledTimes(1)
    expect(swap).toHaveBeenCalledTimes(0)
    expect(send).toHaveBeenCalledTimes(0)
  })
})
