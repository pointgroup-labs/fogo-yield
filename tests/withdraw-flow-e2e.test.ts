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
 * This gap is escalated in `docs/PRE_DEPLOY_CHECKLIST.md` §4 — the
 * devnet soak test (§7) MUST exercise the full withdraw chain end-to-end
 * before mainnet.
 *
 * To implement once the fixture is captured:
 *   1. Add `ONRE_WITHDRAW_OFFER_FIXTURE` constant in `packages/sdk`.
 *   2. Capture via `solana account <pda> --output json` from mainnet.
 *   3. Mirror `tests/deposit-flow-e2e.test.ts`, swapping the directional
 *      args in `loadAndPatchOnreOffer` and creating the boss ONyc ATA
 *      (instead of boss USDC ATA — ONyc is token_in on this leg).
 */

import { describe, it } from 'vitest'

describe.todo('withdraw flow e2e (unlock_onyc → swap_onyc_to_usdc → send_usdc_to_user)', () => {
  it.todo('chains all three withdraw-leg instructions against real OnRe + NTT + TB')
})
