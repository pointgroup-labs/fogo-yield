import { describe, expect, it } from 'vitest'
import { isLostRace } from '../../src/relayer/race-classifier'

describe('isLostRace', () => {
  it('returns reason for Anchor 6022 with `code` shape', () => {
    const reason = isLostRace({ code: 6022, message: 'whatever' })
    expect(reason).toMatch(/InsufficientInboxBalance/)
    expect(reason).toMatch(/6022/)
  })

  it('returns reason for Anchor 6022 with nested `error.errorCode.number` shape', () => {
    const reason = isLostRace({
      error: { errorCode: { number: 6022 } },
    })
    expect(reason).toMatch(/InsufficientInboxBalance/)
  })

  it('returns null for unknown error codes', () => {
    expect(isLostRace({ code: 6000 })).toBe(null)
    expect(isLostRace({ code: 9999 })).toBe(null)
    expect(isLostRace({ error: { errorCode: { number: 1 } } })).toBe(null)
  })

  it('returns null for non-Anchor errors (no code at all)', () => {
    expect(isLostRace(new Error('rpc timeout'))).toBe(null)
    expect(isLostRace('string error')).toBe(null)
    expect(isLostRace(null)).toBe(null)
    expect(isLostRace(undefined)).toBe(null)
    expect(isLostRace({})).toBe(null)
  })

  it('ignores non-numeric `code` values', () => {
    expect(isLostRace({ code: '6022' })).toBe(null)
    expect(isLostRace({ code: { number: 6022 } })).toBe(null)
  })

  it('does NOT classify generic Anchor account errors as benign races', () => {
    // 3002/3012 are deliberately kept out of the table — they fire for
    // any wrong/missing account, not just tracker-closed in the
    // recovery path. Folding them in would silently hide real misconfig.
    expect(isLostRace({ error: { errorCode: { number: 3002 } } })).toBe(null)
    expect(isLostRace({ error: { errorCode: { number: 3012 } } })).toBe(null)
  })

  it('does NOT classify swap_onyc_to_usdc diagnostic variants as races', () => {
    // These are wrong-state or configuration-drift errors from the
    // swap handler, deliberately excluded from the race table. If
    // anyone widens the table to include them, this test fires —
    // forcing a re-justification rather than a silent operator-blinding.
    //
    //   6024 OnycConsumedMismatch          — wrong delegate; swap consumed wrong amount
    //   6025 RedeemSlippageBelowFloor      — market drift, operator must re-quote
    //   6026 OnreNoActiveVector            — Offer pricing state drift
    //   6027 OnreNavOverflow               — math overflow, never benign
    //   6028 OnreOfferTooShort             — Offer layout drift (sha256 tripwire territory)
    //   6029 OnreOfferTokenInMintMismatch  — Offer rebound to different mints
    //   6030 OnreOfferTokenOutMintMismatch — Offer rebound to different mints
    //   6031 OnreOfferOwnerMismatch        — Offer account owner not OnRe
    //   6032 OnreOfferAddressMismatch      — Offer PDA mismatch
    //   6033 OnreInvalidSlippageBps        — misconfigured slippage constant
    for (const code of [6024, 6025, 6026, 6027, 6028, 6029, 6030, 6031, 6032, 6033]) {
      expect(isLostRace({ code })).toBe(null)
    }
  })
})
