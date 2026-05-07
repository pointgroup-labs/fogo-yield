/**
 * Tiny Wormholescan REST client. We need exactly two operations for the
 * cranker:
 *
 *   - Resolve a source-chain tx signature → signed VAA bytes (the
 *     primary `--fogo-tx <SIG>` ergonomic path). Wormholescan exposes
 *     `/api/v1/operations?txHash=<SIG>` which returns the operation
 *     envelope including `vaa.raw` (base64).
 *
 *   - Fetch a signed VAA by `(chain, emitter, sequence)` triple. Used
 *     when an operator already has those identifiers from a previous
 *     trace and wants to replay deterministically.
 *
 * Built on `fetch` (Node 18+) so we don't pull in axios. Errors are
 * thrown as plain Errors with the failing URL + status — operators see
 * them via the CLI's top-level catch.
 */

const DEFAULT_BASE_URL = 'https://api.wormholescan.io'

export interface WormholescanClientOptions {
  baseUrl?: string
  /** Pass-through fetch impl for testing. Defaults to global `fetch`. */
  fetchImpl?: typeof fetch
}

export class WormholescanClient {
  private readonly baseUrl: string
  private readonly fetchImpl: typeof fetch

  constructor(opts: WormholescanClientOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '')
    this.fetchImpl = opts.fetchImpl ?? fetch
  }

  /**
   * Resolve a source-chain tx signature to its emitted signed VAA. Returns
   * `null` when Wormholescan has no operation for the tx — typically
   * because the VAA hasn't been observed by the guardians yet (a few
   * seconds of latency is normal).
   *
   * The /operations endpoint returns an array — we take the first
   * element with a non-empty `vaa.raw`. If the source tx emitted multiple
   * VAAs (rare, but possible for batched ops), the operator can fall
   * back to `findVaaByEmitterSequence` after picking the right
   * (chain, emitter, sequence) by hand.
   */
  async resolveVaaByTxHash(txHash: string): Promise<Uint8Array | null> {
    const url = `${this.baseUrl}/api/v1/operations?txHash=${encodeURIComponent(txHash)}`
    const json = await this.getJson<{
      operations?: Array<{ vaa?: { raw?: string } }>
    }>(url)
    const raw = json.operations?.find(op => op.vaa?.raw)?.vaa?.raw
    if (!raw) {
      return null
    }
    return decodeBase64(raw)
  }

  /**
   * Fetch a signed VAA by its canonical `(chain, emitter, sequence)`
   * triple. `emitter` must be the 32-byte hex-encoded address (no `0x`
   * prefix), matching the format Wormholescan expects on this endpoint.
   *
   * `null` when the VAA isn't present (sequence ahead of latest, or
   * emitter not registered).
   */
  async findVaaByEmitterSequence(
    chain: number,
    emitterHex: string,
    sequence: bigint | number,
  ): Promise<Uint8Array | null> {
    const url = `${this.baseUrl}/api/v1/vaas/${chain}/${emitterHex}/${sequence.toString()}`
    const res = await this.fetchImpl(url)
    if (res.status === 404) {
      return null
    }
    if (!res.ok) {
      throw new Error(`Wormholescan ${res.status} ${res.statusText} for ${url}`)
    }
    const json = (await res.json()) as { data?: { vaa?: string } }
    if (!json.data?.vaa) {
      return null
    }
    return decodeBase64(json.data.vaa)
  }

  private async getJson<T>(url: string): Promise<T> {
    const res = await this.fetchImpl(url)
    if (!res.ok) {
      throw new Error(`Wormholescan ${res.status} ${res.statusText} for ${url}`)
    }
    return (await res.json()) as T
  }
}

function decodeBase64(b64: string): Uint8Array {
  return Uint8Array.from(Buffer.from(b64, 'base64'))
}
