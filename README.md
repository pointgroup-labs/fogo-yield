# Plan

## Phase 1: Relayer + NTT only

Deposit:

1. User sends USDC.s via Gateway on FOGO > USDC arrives at relayer PDA on Solana
2. Relayer swaps USDC > ONyc on OnRe (fee skimmed here)
3. Relayer NTT-locks ONyc > bONyc minted to user on FOGO
4. User holds bONyc directly

Withdraw:

1. User burns bONyc on FOGO via NTT > ONyc released to relayer PDA
2. Relayer swaps ONyc > USDC on OnRe (fee skimmed here)
3. Relayer bridges USDC via Gateway > USDC.s to user on FOGO

User signs one tx on FOGO (Gateway transfer or NTT burn). Relayer + cranker handle Solana side. User holds bONyc, yield accrues automatically as ONyc price appreciates.

Tradeoffs in phase 1:

- No instant withdrawals (every withdraw crosses 2 bridges + OnRe queue)
- No reserve pool
- OnRe 2.5%/week redemption cap hits users directly

## Phase 2: Add FOGO vault in front

The relayer stays exactly the same. We just put the FOGO vault in front of it:

User > FOGO Vault > (relayer + NTT in background)

Vault adds: instant withdrawals, reserve pool, share token (wONyc), governance. The relayer doesn't change, it already does what the vault needs.
