# Plan

> **⚠️ Status (Apr 2026): the withdraw chain (Phase 1 step 2 below)
> is non-functional.** Verified against `onre-finance/onre-sol`: OnRe
> exposes no permissionless ONyc→USDC swap. Withdrawals must go
> through `RedemptionOffer` (`create_redemption_request` →
> admin-fulfilled `fulfill_redemption_request`), which the current
> relayer does not implement. The Phase 2 "instant withdrawals"
> claim therefore does not hold once the reserve drains, since the
> reserve cannot be replenished. See `docs/deploy-checklist.md`
> §4 and `docs/architecture.md` (top-of-file banner) for the full
> picture and resolution paths. Deposits are unaffected.

## Phase 1: Relayer + NTT only

Deposit:

1. User sends USDC.s via Gateway on FOGO > USDC arrives at relayer PDA on Solana
2. Relayer swaps USDC > ONyc on OnRe (fee skimmed here)
3. Relayer NTT-locks ONyc > bONyc minted to user on FOGO
4. User holds bONyc directly

Withdraw (**non-functional today, see banner above**):

1. User burns bONyc on FOGO via NTT > ONyc released to relayer PDA
2. Relayer swaps ONyc > USDC on OnRe (fee skimmed here) — **⚠️ no such permissionless instruction exists in OnRe**
3. Relayer bridges USDC via Gateway > USDC.s to user on FOGO

User signs one tx on FOGO (Gateway transfer or NTT burn). Relayer + cranker handle Solana side. User holds bONyc, yield accrues automatically as ONyc price appreciates.

Tradeoffs in phase 1:

- No instant withdrawals (every withdraw crosses 2 bridges + OnRe queue)
- No reserve pool
- OnRe 2.5%/week redemption cap hits users directly

## Phase 2: Add FOGO vault in front

The relayer stays exactly the same. We just put the FOGO vault in front of it:

User > FOGO Vault > (relayer + NTT in background)

Vault adds: instant withdrawals, reserve pool, share token (wONyc), governance. The relayer doesn't change, it already does what the vault needs. **⚠️ "Instant withdrawals" only holds while the reserve has USDC.s; replenishing the reserve from Solana requires the broken Phase 1 withdraw chain to be fixed first.**

---

OnRe codebase:
https://github.com/onre-finance/onre-sol/
