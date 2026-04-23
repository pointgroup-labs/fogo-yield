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
 * **Mainnet status (verified Apr 2026 against OnRe source
 * `onre-finance/onre-sol`)**: OnRe does NOT model withdrawals as a
 * symmetric back-direction `Offer`. They are a separate
 * `RedemptionOffer` account type with its own seed prefix and a
 * two-step async flow. Concretely:
 *
 *   - `findOnreOfferPda(ONyc, USDC)` → `HwWKn7CK…` returns
 *     `AccountNotFound` on mainnet — and never will exist, because
 *     OnRe's design doesn't put one there.
 *   - The actual withdraw counterparty is a `RedemptionOffer` at
 *     `[seeds::REDEMPTION_OFFER, ONyc, USDC]` →
 *     `3pLK2vXD2uy9PPZuYZNZWkkP9CTEuGrhS2uYFRUWZrSu`. **This account
 *     IS deployed on mainnet** (verified via `solana account`).
 *   - The OnRe entry points for withdraw are
 *     `create_redemption_request` (signed by redeemer) and
 *     `fulfill_redemption_request` (gated on `boss ||
 *     redemption_admin`). There is NO `take_redemption_offer_
 *     permissionless` analog to the deposit-side
 *     `take_offer_permissionless`.
 *
 * **Implication**: the relayer's `swap_onyc_to_usdc` handler CPIs into
 * `take_offer_permissionless` (an `Offer` instruction) and would fail
 * account-type validation against a `RedemptionOffer`. The relayer
 * cannot crank withdrawals against the OnRe protocol as currently
 * coded. This is escalated from "missing test fixture" to
 * "architectural mismatch with the OnRe API". See
 * `docs/PRE_DEPLOY_CHECKLIST.md` §4.
 *
 * Resolution paths:
 *   1. Redesign the withdraw chain into two relayer instructions:
 *      `request_redemption` (CPIs `create_redemption_request`) and
 *      `claim_redemption` (consumes OnRe's admin-fulfilled USDC).
 *      Add a `RedemptionPending` Flow status between `Claimed` and
 *      `Swapped`. This loses single-call atomicity and introduces a
 *      soft dependency on OnRe's `redemption_admin` to fulfill —
 *      revisit the §8 cranking model accordingly.
 *   2. Coordinate with OnRe to add a permissionless atomic
 *      counterpart to `take_offer_permissionless` for
 *      `RedemptionOffer`. This preserves the current relayer shape
 *      but is an external-protocol change.
 */

import { describe, it } from 'vitest'

describe.todo('withdraw flow e2e (unlock_onyc → swap_onyc_to_usdc → send_usdc_to_user)', () => {
  it.todo('chains all three withdraw-leg instructions against real OnRe + NTT + TB')
})
