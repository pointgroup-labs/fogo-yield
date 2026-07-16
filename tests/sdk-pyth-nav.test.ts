import { Buffer } from 'node:buffer'
import {
  decodeNavFromPriceUpdate,
  decodePriceUpdate,
  getPythPriceFeedAccount,
  ONYC_PYTH_FEED_ID,
} from '@ignitionfi/fogo-yield-sdk'
import { describe, expect, it } from 'vitest'

// PriceUpdateV2 relative to the feed id: price i64 @+32, conf u64 @+40,
// exponent i32 @+48, publish_time i64 @+52. A non-zero prefix exercises the
// "locate the feed id first" path (the layout is not at offset 0).
function synthPriceUpdate(feedIdHex: string, price: bigint, expo: number, publishTime: bigint, prefix = 11): Buffer {
  const buf = Buffer.alloc(prefix + 60)
  Buffer.from(feedIdHex, 'hex').copy(buf, prefix)
  buf.writeBigInt64LE(price, prefix + 32)
  buf.writeInt32LE(expo, prefix + 48)
  buf.writeBigInt64LE(publishTime, prefix + 52)
  return buf
}

describe('getPythPriceFeedAccount', () => {
  it('derives the known ONyc sponsored account at shard 0', () => {
    expect(getPythPriceFeedAccount(ONYC_PYTH_FEED_ID, 0).toBase58())
      .toBe('8uto8utKdfs2ajrmBtcFL5s9mXbc7UPg8HSdLwCn1Mg7')
  })

  it('derives a different account per shard', () => {
    expect(getPythPriceFeedAccount(ONYC_PYTH_FEED_ID, 1).toBase58())
      .not
      .toBe(getPythPriceFeedAccount(ONYC_PYTH_FEED_ID, 0).toBase58())
  })
})

describe('decodePriceUpdate', () => {
  it('reads price/expo/publishTime relative to the feed id', () => {
    const data = synthPriceUpdate(ONYC_PYTH_FEED_ID, 107_000_000n, -8, 1_700_000_000n)
    expect(decodePriceUpdate(data, ONYC_PYTH_FEED_ID))
      .toEqual({ price: 107_000_000n, expo: -8, publishTime: 1_700_000_000 })
  })

  it('returns null when the feed id is absent', () => {
    const data = synthPriceUpdate(ONYC_PYTH_FEED_ID, 1n, -8, 1n)
    expect(decodePriceUpdate(data, 'ab'.repeat(32))).toBeNull()
  })
})

describe('decodeNavFromPriceUpdate', () => {
  it('applies the exponent to yield USD NAV', () => {
    const data = synthPriceUpdate(ONYC_PYTH_FEED_ID, 107_000_000n, -8, 1n)
    expect(decodeNavFromPriceUpdate(data, ONYC_PYTH_FEED_ID)).toBeCloseTo(1.07)
  })

  it('returns null when the feed id is absent', () => {
    const data = synthPriceUpdate(ONYC_PYTH_FEED_ID, 1n, -8, 1n)
    expect(decodeNavFromPriceUpdate(data, 'cd'.repeat(32))).toBeNull()
  })
})
