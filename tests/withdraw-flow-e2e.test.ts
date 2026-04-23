/**
 * Placeholder for the full withdraw-chain e2e:
 *   unlock_onyc → swap_onyc_to_usdc → send_usdc_to_user
 *
 * Status (Apr 2026): NOT YET IMPLEMENTED.
 *
 * Three component tests already cover the legs in isolation:
 *   - `tests/unlock-onyc-e2e.test.ts`         — real NTT redeem + release
 *   - `tests/relayer.test.ts:1099` (`swap_onyc_to_usdc with Claimed flow
 *     attempts OnRe CPI`) — proves relayer-side guards pass; the OnRe
 *     CPI itself is *expected to fail* because no withdraw-direction
 *     Offer fixture exists.
 *   - `tests/send-usdc-to-user-e2e.test.ts`   — real TB outbound burn
 *
 * What is missing to stitch them: a captured-from-mainnet OnRe Offer
 * fixture for (token_in=ONyc, token_out=USDC) at PDA
 * `findOnreOfferPda(onyc, usdc)`. The deposit-direction Offer
 * (`ONRE_OFFER_FIXTURE`) is NOT directionally symmetric — base_price /
 * apr fields encode ONyc-as-output pricing.
 *
 * **Mainnet status (verified Apr 2026)**: the withdraw-direction Offer
 * PDA derives to `HwWKn7CK2aqnVtz5mRi87A8CzTDEhKJVbJdfKELFLuA`
 * (`findOnreOfferPda(5Y8N…ONyc, EPjF…USDC)`). `solana account
 * HwWKn7CK… --url mainnet-beta` returns `AccountNotFound`. In other
 * words, the OnRe protocol operator has not yet published a back-swap
 * Offer at all — the relayer's `swap_onyc_to_usdc` instruction has no
 * live counterparty to CPI into on mainnet today.
 *
 * Implication: this is escalated from "missing test coverage" to
 * "missing dependency". See `docs/PRE_DEPLOY_CHECKLIST.md` §4.
 *
 * Two possible resolutions, in order of preference:
 *   1. OnRe operator publishes a withdraw-direction Offer at the PDA
 *      above. Then capture the fixture (`solana account <pda> --output
 *      json`), add `ONRE_WITHDRAW_OFFER_FIXTURE` to `packages/sdk`,
 *      and mirror `tests/deposit-flow-e2e.test.ts` with directional
 *      args swapped + boss ONyc ATA (ONyc is token_in on this leg).
 *   2. Withdrawals use a different OnRe entry point entirely (redeem,
 *      queue, etc). In that case the relayer's `swap_onyc_to_usdc`
 *      handler needs a redesign — `take_offer_permissionless` is the
 *      wrong CPI target.
 */

import { describe, it } from 'vitest'

describe.todo('withdraw flow e2e (unlock_onyc → swap_onyc_to_usdc → send_usdc_to_user)', () => {
  it.todo('chains all three withdraw-leg instructions against real OnRe + NTT + TB')
})
