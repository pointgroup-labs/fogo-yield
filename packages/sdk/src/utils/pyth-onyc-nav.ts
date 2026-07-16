import { Buffer } from 'node:buffer'
import { PublicKey } from '@solana/web3.js'
import { ONYC_PYTH_FEED_ID, PYTH_PUSH_ORACLE_PROGRAM_ID } from '../constants'

/**
 * ONyc NAV via Pyth — the maintained, cross-chain-portable oracle alternative to
 * decoding OnRe's on-chain `Offer` account. These are pure helpers (no side
 * effects beyond a single `fetch`); posting the update on-chain lives in the
 * cranker, which owns the heavier `@pythnetwork/*` dependency.
 */

export const HERMES_ENDPOINT = 'https://hermes.pyth.network'

export interface PythOnycNav {
  /** NAV in USD per whole ONyc (price × 10^expo — decimals already applied). */
  navUsd: number
  /** Unix seconds the price was published on-chain. */
  publishTime: number
  /** Raw fixed-point price and exponent, for callers that want integer math. */
  price: bigint
  expo: number
}

/** Fetch the live ONyc NAV from Pyth Hermes (defaults to feed `ONYC_PYTH_FEED_ID`). */
export async function fetchOnycNavFromHermes(
  endpoint = HERMES_ENDPOINT,
  feedId = ONYC_PYTH_FEED_ID,
): Promise<PythOnycNav> {
  const res = await fetch(`${endpoint}/v2/updates/price/latest?ids[]=${feedId}&parsed=true`)
  if (!res.ok) {
    throw new Error(`Pyth Hermes returned ${res.status}`)
  }
  const json = await res.json() as {
    parsed?: { price?: { price: string, expo: number, publish_time: number } }[]
  }
  const p = json.parsed?.[0]?.price
  if (!p) {
    throw new Error('Pyth Hermes: no parsed price for the ONyc feed')
  }
  return {
    navUsd: Number(p.price) * 10 ** Number(p.expo),
    publishTime: Number(p.publish_time),
    price: BigInt(p.price),
    expo: Number(p.expo),
  }
}

/**
 * Deterministic address of the sponsored price-feed account for a feed. It's a
 * PDA of the push-oracle program, so the address is identical on any SVM chain
 * that runs Pyth (Solana and FOGO). The account only *exists* on a chain once a
 * keeper posts updates for that feed there.
 */
export function getPythPriceFeedAccount(feedId: string, shardId = 0): PublicKey {
  const shard = Buffer.alloc(2)
  shard.writeUInt16LE(shardId, 0)
  return PublicKey.findProgramAddressSync([shard, Buffer.from(feedId, 'hex')], PYTH_PUSH_ORACLE_PROGRAM_ID)[0]
}

export interface DecodedPriceUpdate {
  price: bigint
  expo: number
  /** Unix seconds the price was published on-chain. */
  publishTime: number
}

/**
 * Decode a Pyth `PriceUpdateV2` account. Locates the feed id (robust to the
 * variable-length verification field) and reads the fields that follow it:
 * price @ +32, exponent @ +48, publish_time @ +52. Returns `null` if absent.
 */
export function decodePriceUpdate(data: Uint8Array, feedId: string): DecodedPriceUpdate | null {
  const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength)
  const off = buf.indexOf(Buffer.from(feedId, 'hex'))
  if (off < 0) {
    return null
  }
  return {
    price: buf.readBigInt64LE(off + 32),
    expo: buf.readInt32LE(off + 48),
    publishTime: Number(buf.readBigInt64LE(off + 52)),
  }
}

/** ONyc NAV (USD per ONyc) from a `PriceUpdateV2` account, or `null` if absent. */
export function decodeNavFromPriceUpdate(data: Uint8Array, feedId = ONYC_PYTH_FEED_ID): number | null {
  const decoded = decodePriceUpdate(data, feedId)
  return decoded ? Number(decoded.price) * 10 ** decoded.expo : null
}
