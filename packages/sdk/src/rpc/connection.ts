import type { Commitment, ConnectionConfig } from '@solana/web3.js'
import { Connection } from '@solana/web3.js'

export interface RateLimitedFetchOptions {
  /** Steady-state request ceiling (requests/sec). Default 10. */
  maxRps?: number
  /** Bucket capacity — how far a quiet period lets you burst. Default = maxRps. */
  burst?: number
  /** Retries on HTTP 429 before giving up and returning the 429. Default 5. */
  maxRetries?: number
  /** First 429 backoff (ms); doubles per attempt, plus jitter. Default 500. */
  baseBackoffMs?: number
  /** Ceiling on a single backoff wait (ms). Default 15_000. */
  maxBackoffMs?: number
  /** Injectable seams for tests (default to the real fetch/clock/timer/rng). */
  fetchImpl?: typeof fetch
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  random?: () => number
}

/**
 * Wrap a `fetch` with a token-bucket rate limiter and 429 backoff. Two
 * independent controls: the bucket paces *outgoing* requests to stay under
 * `maxRps` (prevents the burst that trips the limit); the backoff recovers
 * from the occasional 429 with exponential delay + jitter, honoring a
 * `Retry-After` header when the server sends one. Token grants are
 * serialized (FIFO), so N concurrent callers drain at exactly `maxRps`.
 */
export function createRateLimitedFetch(opts: RateLimitedFetchOptions = {}): typeof fetch {
  const maxRps = Math.max(0.001, opts.maxRps ?? 10)
  const capacity = Math.max(1, opts.burst ?? maxRps)
  const maxRetries = opts.maxRetries ?? 5
  const baseBackoffMs = opts.baseBackoffMs ?? 500
  const maxBackoffMs = opts.maxBackoffMs ?? 15_000
  const fetchImpl = opts.fetchImpl ?? fetch
  const now = opts.now ?? (() => Date.now())
  const sleep = opts.sleep ?? (ms => new Promise<void>(r => setTimeout(r, ms)))
  const random = opts.random ?? Math.random

  let tokens = capacity
  let last = now()
  // Serialize acquisition so concurrent callers queue instead of all
  // spending the same refill; the chain also enforces FIFO fairness.
  let gate: Promise<void> = Promise.resolve()

  async function acquire(): Promise<void> {
    const prev = gate
    let release: () => void = () => {}
    gate = new Promise<void>((r) => {
      release = r
    })
    await prev
    try {
      for (;;) {
        const t = now()
        tokens = Math.min(capacity, tokens + ((t - last) / 1000) * maxRps)
        last = t
        if (tokens >= 1) {
          tokens -= 1
          return
        }
        await sleep(Math.ceil(((1 - tokens) / maxRps) * 1000))
      }
    } finally {
      release()
    }
  }

  return async function rateLimitedFetch(input, init) {
    for (let attempt = 0; ; attempt++) {
      await acquire()
      const res = await fetchImpl(input as Parameters<typeof fetch>[0], init)
      if (res.status !== 429 || attempt >= maxRetries) {
        return res
      }
      const retryAfterMs = parseRetryAfter(res.headers.get('retry-after'), now)
      const backoff = retryAfterMs ?? Math.min(maxBackoffMs, baseBackoffMs * 2 ** attempt)
      await sleep(backoff + Math.floor(backoff * 0.5 * random()))
    }
  }
}

export interface RateLimitedConnectionOptions extends RateLimitedFetchOptions {
  commitment?: Commitment
  wsEndpoint?: string
  httpHeaders?: Record<string, string>
  confirmTransactionInitialTimeout?: number
}

/**
 * A web3.js `Connection` that paces its own HTTP under `maxRps` and owns
 * 429 recovery. `disableRetryOnRateLimit` turns off web3.js's built-in
 * fixed-500ms retry (no backoff, noisy logs) in favor of the wrapped
 * fetch's jittered exponential backoff.
 */
export function createRateLimitedConnection(endpoint: string, opts: RateLimitedConnectionOptions = {}): Connection {
  const config: ConnectionConfig = {
    commitment: opts.commitment,
    wsEndpoint: opts.wsEndpoint,
    httpHeaders: opts.httpHeaders,
    confirmTransactionInitialTimeout: opts.confirmTransactionInitialTimeout,
    disableRetryOnRateLimit: true,
    fetch: createRateLimitedFetch(opts) as ConnectionConfig['fetch'],
  }
  return new Connection(endpoint, config)
}

/** `Retry-After` is either delta-seconds or an HTTP-date; return ms, or null. */
function parseRetryAfter(header: string | null, now: () => number): number | null {
  if (!header) {
    return null
  }
  const secs = Number(header)
  if (Number.isFinite(secs)) {
    return Math.max(0, secs * 1000)
  }
  const at = Date.parse(header)
  return Number.isFinite(at) ? Math.max(0, at - now()) : null
}
