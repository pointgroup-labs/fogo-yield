import type { AccountInfo, Connection } from '@solana/web3.js'
import { createRateLimitedConnection, createRateLimitedFetch, getMultipleAccountsChunked } from '@ignitionfi/fogo-yield-sdk'
import { PublicKey } from '@solana/web3.js'
import { describe, expect, it, vi } from 'vitest'

function fakeConn(handler: (keys: PublicKey[]) => (AccountInfo<Buffer> | null)[]): Connection {
  return { getMultipleAccountsInfo: vi.fn(async (keys: PublicKey[]) => handler(keys)) } as unknown as Connection
}

describe('getMultipleAccountsChunked', () => {
  it('splits into <=100-key calls and preserves input order', async () => {
    const keys = Array.from({ length: 250 }, (_, i) => i) as unknown as PublicKey[]
    const conn = fakeConn(ks => (ks as unknown as number[]).map(k => ({ marker: k } as unknown as AccountInfo<Buffer>)))
    const out = await getMultipleAccountsChunked(conn, keys)
    expect(conn.getMultipleAccountsInfo).toHaveBeenCalledTimes(3)
    expect((conn.getMultipleAccountsInfo as any).mock.calls.map((c: any[]) => c[0].length)).toEqual([100, 100, 50])
    expect(out.map(o => (o as any).marker)).toEqual(keys)
  })

  it('returns [] for empty input without any RPC call', async () => {
    const conn = fakeConn(() => [])
    expect(await getMultipleAccountsChunked(conn, [])).toEqual([])
    expect(conn.getMultipleAccountsInfo).not.toHaveBeenCalled()
  })

  it('passes null through for missing accounts', async () => {
    const keys = [0, 1, 2] as unknown as PublicKey[]
    const conn = fakeConn(() => [{ lamports: 1 } as AccountInfo<Buffer>, null, { lamports: 3 } as AccountInfo<Buffer>])
    const out = await getMultipleAccountsChunked(conn, keys)
    expect(out[1]).toBeNull()
    expect(out).toHaveLength(3)
  })
})

describe('createRateLimitedFetch — 429 backoff', () => {
  const ok = () => new Response('ok', { status: 200 })
  const rateLimited = (headers?: Record<string, string>) => new Response('', { status: 429, headers })

  it('retries a 429 then returns the success, with exponential backoff', async () => {
    const sleeps: number[] = []
    let clock = 0
    const fetchImpl = vi.fn().mockResolvedValueOnce(rateLimited()).mockResolvedValueOnce(ok())
    const f = createRateLimitedFetch({
      maxRps: 1e6,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => clock,
      sleep: async (ms) => {
        clock += ms
        sleeps.push(ms)
      },
      random: () => 0,
    })
    const res = await f('http://rpc')
    expect(res.status).toBe(200)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(sleeps).toContain(500) // baseBackoffMs * 2^0, jitter=0
  })

  it('gives up after maxRetries and returns the 429', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(rateLimited())
    const f = createRateLimitedFetch({
      maxRps: 1e6,
      maxRetries: 2,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: async () => {},
      random: () => 0,
    })
    const res = await f('http://rpc')
    expect(res.status).toBe(429)
    expect(fetchImpl).toHaveBeenCalledTimes(3) // attempts 0,1,2
  })

  it('honors a numeric Retry-After header over the exponential schedule', async () => {
    const sleeps: number[] = []
    const fetchImpl = vi.fn().mockResolvedValueOnce(rateLimited({ 'retry-after': '2' })).mockResolvedValueOnce(ok())
    const f = createRateLimitedFetch({
      maxRps: 1e6,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: async (ms) => { sleeps.push(ms) },
      random: () => 0,
    })
    await f('http://rpc')
    expect(sleeps).toContain(2000)
  })
})

describe('createRateLimitedConnection — wiring', () => {
  it('routes the Connection\'s RPC HTTP through the rate-limited fetch', async () => {
    // Proves web3.js actually uses our custom `fetch` (config.fetch) — a
    // read-of-source claim isn't enough; a version bump could break it.
    const body = JSON.stringify({ jsonrpc: '2.0', id: '1', result: { context: { slot: 0 }, value: null } })
    const fetchImpl = vi.fn(async () => new Response(body, { status: 200, headers: { 'content-type': 'application/json' } }))
    const conn = createRateLimitedConnection('http://localhost:8899', { fetchImpl: fetchImpl as unknown as typeof fetch, maxRps: 1000 })
    await conn.getAccountInfo(new PublicKey('11111111111111111111111111111111')).catch(() => {})
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(fetchImpl.mock.calls[0][0]).toBe('http://localhost:8899')
    expect((fetchImpl.mock.calls[0][1] as RequestInit).method).toBe('POST')
  })
})

describe('createRateLimitedFetch — token-bucket throttle', () => {
  it('paces requests once the burst is spent', async () => {
    const sleeps: number[] = []
    let clock = 0
    const fetchImpl = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }))
    const f = createRateLimitedFetch({
      maxRps: 10,
      burst: 2,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => clock,
      sleep: async (ms) => {
        clock += ms
        sleeps.push(ms)
      },
    })
    await f('http://rpc') // token 2 -> 1
    await f('http://rpc') // token 1 -> 0
    expect(sleeps).toHaveLength(0)
    await f('http://rpc') // bucket empty -> must wait ~100ms for 1 token at 10 rps
    expect(sleeps).toHaveLength(1)
    expect(sleeps[0]).toBeGreaterThanOrEqual(90)
  })
})
