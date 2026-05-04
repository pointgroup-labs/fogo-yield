'use client'

/**
 * Live OnRe ONyc-price decoder.
 *
 * Decodes the OnRe `Offer` account into the active price vector and
 * computes a spot ONyc price. Layout (verified against the mainnet offer
 * fixture `E88zkA9Pxb1i8EfSHrEW5ZUe6hiQbo8DHWQ3WhDFw7p6`):
 *
 *   disc(8)
 *     + token_in_mint(32) @ 8
 *     + token_out_mint(32) @ 40
 *     + price_vectors[N] @ 72  (40 bytes each, little-endian)
 *         u64 start_time
 *         u64 effective_start
 *         u64 base_price        // scaled by PRICE_SCALE (1e12)
 *         u64 apr               // scaled by APR_SCALE (1e6 = 100%)
 *         u64 duration          // seconds
 *     + remaining admin/state fields after the vector array
 *
 * Vector count is not encoded in a header; we walk stride-40 from offset 72
 * and stop at the first all-zero slot or the first slot whose `start_time`
 * looks implausible (outside [2020-01-01, 2200-01-01]). That's the same
 * heuristic the test scaffolding uses when patching the last vector.
 *
 * **Why this isn't an SDK module.** The OnRe SDK files in this repo are
 * under tightened modification rules; the webapp can decode the published
 * account format on its own without growing the SDK surface. If/when this
 * lands in the SDK proper, the constants below transplant verbatim.
 */

/**
 * `priceScale` for OnRe. Determined empirically from the mainnet fixture:
 * `basePrice = 1_069_802_350` corresponds to ~1.07 USDC per ONyc, which
 * with USDC=6 and ONyc=9 decimals only typechecks against `priceScale = 1e12`
 * (real_ratio = 1.07e9 / 1e12 = 0.00107 USDC base / ONyc base = 1.07 USDC / 1 ONyc).
 */
export const ONRE_PRICE_SCALE = 1_000_000_000_000n

/** APR units: on-chain `apr` divided by this gives the real fractional rate. */
const APR_SCALE = 1_000_000n

/** Seconds in a 365-day year — matches the architecture-doc price formula. */
const SECONDS_PER_YEAR = 31_536_000n

const VECTOR_STRIDE = 40
const VECTORS_OFFSET = 72

// Plausibility window for `start_time`. Outside this we treat the slot as
// past-the-end of the vector array (zero-init or struct boundary).
const PLAUSIBLE_MIN_TS = 1_577_836_800n // 2020-01-01
const PLAUSIBLE_MAX_TS = 7_258_118_400n // 2200-01-01

export interface OnreOfferPriceVector {
  startTime: bigint
  effectiveStart: bigint
  basePrice: bigint
  apr: bigint
  duration: bigint
}

/** Walk the vector array and return all plausibly-real entries in order. */
export function decodeOnreOfferPriceVectors(data: Uint8Array): OnreOfferPriceVector[] {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const out: OnreOfferPriceVector[] = []
  for (let off = VECTORS_OFFSET; off + VECTOR_STRIDE <= data.byteLength; off += VECTOR_STRIDE) {
    const startTime = view.getBigUint64(off, true)
    if (startTime < PLAUSIBLE_MIN_TS || startTime > PLAUSIBLE_MAX_TS) {
      // Hit zero-init or the next struct field — vector array ends here.
      break
    }
    out.push({
      startTime,
      effectiveStart: view.getBigUint64(off + 8, true),
      basePrice: view.getBigUint64(off + 16, true),
      apr: view.getBigUint64(off + 24, true),
      duration: view.getBigUint64(off + 32, true),
    })
  }
  return out
}

/**
 * Pick the vector that covers `nowSeconds` (`start <= now < start + duration`).
 * Falls back to the latest vector whose `start <= now` (extrapolating its
 * APR forward); if `now` is before every vector, returns the earliest.
 *
 * Returns `null` only when the array is empty.
 */
export function selectActiveVector(
  vectors: OnreOfferPriceVector[],
  nowSeconds: bigint,
): OnreOfferPriceVector | null {
  if (vectors.length === 0) {
    return null
  }
  let active: OnreOfferPriceVector | null = null
  let latestPast: OnreOfferPriceVector | null = null
  for (const v of vectors) {
    if (v.startTime <= nowSeconds && nowSeconds < v.startTime + v.duration) {
      active = v // exact-cover wins immediately
    }
    if (v.startTime <= nowSeconds) {
      if (latestPast === null || v.startTime > latestPast.startTime) {
        latestPast = v
      }
    }
  }
  return active ?? latestPast ?? vectors[0] ?? null
}

/**
 * Compute the spot ONyc price (in `ONRE_PRICE_SCALE` units) at `nowSeconds`,
 * accruing linearly from `effective_start`:
 *
 *   onyc_price = base_price * (1 + apr/APR_SCALE * elapsed/SECONDS_PER_YEAR)
 *
 * For times before `effective_start`, returns `base_price` unchanged.
 */
export function computeOnycPriceFromVector(
  vector: OnreOfferPriceVector,
  nowSeconds: bigint,
): bigint {
  const start = vector.effectiveStart > 0n ? vector.effectiveStart : vector.startTime
  const elapsed = nowSeconds > start ? nowSeconds - start : 0n
  if (elapsed === 0n || vector.apr === 0n) {
    return vector.basePrice
  }
  const accrued
    = (vector.basePrice * vector.apr * elapsed)
      / (APR_SCALE * SECONDS_PER_YEAR)
  return vector.basePrice + accrued
}
