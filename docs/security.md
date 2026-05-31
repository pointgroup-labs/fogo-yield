# Security Model

This document captures the trust boundaries of the fogo-onre relayer
program: which keys exist, what each can do, and what happens if each is
compromised.

The relayer's headline property — **"the relayer has no privileged caller"** —
means every flow-driving instruction (`claim_usdc`, `swap_usdc_to_onyc`,
`lock_onyc`, `unlock_onyc`, `swap_onyc_to_usdc`,
`send_usdc_to_user`) is **permissionless**: any
wallet on the network can submit them. Safety does not depend on who pays
the transaction fee. This is the result of several layered design choices
documented here. None of the layers individually is sufficient; the model
assumes all are in place.

> **Withdraw-chain soft dependency.** OnRe redemptions are KYC-gated and
> the relayer PDA cannot complete KYC, so the withdraw leg converts the
> unlocked ONyc to USDC through a third-party swap router (Jupiter today,
> router-agnostic) in `swap_onyc_to_usdc`, not through an OnRe redemption.
> This soft-depends on two upstreams: the OnRe deposit `Offer` staying
> live (it sets the NAV floor — see §3) and the router holding ONyc→USDC
> liquidity above that floor. If either is unavailable the swap reverts
> and the ONyc waits in the relayer's authority-owned ATA until a later
> retry succeeds — there is no async-fulfillment actor to stall and no
> cancel path. See §3 (OnRe row) and §4.2.5 for the bounded surface.

---

## 1. Key inventory

| Key                             | Holder                            | Lifecycle                                                                                                                                                                                                                                   | On-chain capability                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Upgrade authority**           | Multisig (or `None` if immutable) | Set at deploy, never rotated                                                                                                                                                                                                                | Can replace the relayer `.so`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **Config authority**            | Set at `initialize` time          | Two-step rotation: `configure` proposes (current authority signs); `accept_authority` finalizes (proposed key signs, separately). The two parties never need to sign the same transaction — supports independent multisig→multisig handoff. | **Set fees up to `MAX_FEE_BPS` (10%) per leg with 2-day timelock on increases, redirect `fee_vault` to attacker-controlled account, loosen swap slippage up to `MAX_SLIPPAGE_BPS` (2%), propose+accept-rotate authority to attacker key.** See §4.2.5 — bounded blast radius. Cannot drain operating ATAs (no instruction lets the authority sign for `usdc_ata` / `onyc_ata` outflows; only the handler chain bound to specific `Flow` PDAs can), cannot redirect per-flow outbound recipients (those are bound to `flow.fogo_sender`), cannot bypass `MAX_FEE_BPS`. |
| **OnRe price-vector authority** | OnRe governance / multisig        | OnRe-controlled, not in this repo                                                                                                                                                                                                           | Updates ONyc price parameters that the OnRe vault reads via Wormhole Queries.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **NTT manager admin**           | Wormhole Foundation / OnRe ops    | Wormhole-controlled, not in this repo                                                                                                                                                                                                       | Adjusts NTT rate limits, registered transceivers, peers.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **Wormhole guardians**          | 19 Wormhole guardian set          | Rotated by Wormhole governance                                                                                                                                                                                                              | Sign VAAs that the relayer consumes via NTT.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **OnRe boss**                   | OnRe governance                   | OnRe-controlled, not in this repo                                                                                                                                                                                                           | Receives token-in fees on `take_offer_permissionless`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

There is **no operator / curator / cranker key** in the relayer's trust
model. Anyone with enough SOL to pay the transaction fee can submit any
flow-driving instruction. This is intentional: making cranking
permissionless eliminates an entire class of "what if the operator is
malicious / unavailable / compromised" failure modes.

The relayer program itself owns **no keys** — every long-lived authority
on its accounts is a PDA derived from the program ID + a fixed seed.
There is no "admin" with elevated access to relayer state.

## 2. PDA inventory

Every account the relayer authorities over is a PDA. The seeds are
defined in `programs/relayer/src/constants.rs` and mirrored in the SDK.

| PDA                   | Seeds                                                                                               | Owner / signer  | Purpose                                                                                         |
| --------------------- | --------------------------------------------------------------------------------------------------- | --------------- | ----------------------------------------------------------------------------------------------- |
| Relayer authority     | `[b"relayer"]`                                                                                      | Relayer program | Owns the long-lived USDC and ONyc ATAs; signs every outbound CPI.                               |
| User inbox authority  | `[b"user_inbox", user_wallet]`                                                                      | Relayer program | Owns the per-user `user_inbox_ata` NTT `release_inbound` deposits into; PDA-signs the sweep of exactly `inbox_item.amount` into the relayer USDC ATA. |
| Config                | `[b"relayer_config"]`                                                                               | Relayer program | Stores `usdc_mint`, `onyc_mint`, fee BPS, fee vault. Settable only by the configured authority. |
| Inbound Flow          | `[b"inflight", ntt_inbox_item]`                                                                     | Relayer program | Receipt for an in-progress deposit. Init-once on `claim_usdc`.                                  |
| Outbound Flow         | `[b"outflight", ntt_inbox_item]`                                                                    | Relayer program | Receipt for an in-progress withdrawal. Init-once on `unlock_onyc`.                              |
| NTT session authority | `[b"session_authority", sender, keccak(transfer_args)]` (under `NTT_ONYC_PROGRAM_ID`, not the relayer's) | NTT program     | Per-call delegate for `transfer_lock`.                                                          |

**Key property**: every Flow PDA is seeded by the _NTT inbox-item PDA_
for that message, which the NTT manager creates via CPI when it accepts
a guardian-signed VAA. A caller cannot forge a Flow seed without the NTT
manager first accepting that VAA — i.e., replay protection is inherited
from Wormhole/NTT.

## 3. Trust boundaries

### Wormhole guardians (19-of-19 threshold for governance, 13-of-19 for messages)

Trusted to honestly attest source-chain events. Compromise of ≥13 guardian
keys would let an attacker forge a `claim_usdc` NTT VAA and direct minted
USDC

- associated ONyc to an attacker-controlled FOGO address. Outside the
  relayer's control; mitigated by Wormhole's own operational security.

### NTT inbound redeem + intent-setter allowlist (deposit leg)

The deposit leg redeems inbound USDC through the NTT USDC manager
(`claim_usdc`: `redeem` + `release_inbound_unlock`) — there is **no
Wormhole Token Bridge or Gateway dependency left in the stack**; both
legs migrated to NTT. NTT release deposits into a per-user inbox ATA
owned by `pda([b"user_inbox", user_wallet])`, and the relayer sweeps
exactly `inbox_item.amount`. Two pins stop a stolen cranker key from
redirecting funds: the recipient is forced to the user's own inbox PDA
(`inbox_item.recipient_address` re-derived and required equal), and the
NTT message `sender` must be in the **{OnRe, Fogo} intent-setter
allowlist** (`allowed_intent_setters()`) — a direct, non-intent NTT
bridge to the same recipient is rejected (`UnexpectedFogoSender`). The
manager IDs and instruction discriminators are pinned as `pub const`
values in `programs/relayer/src/constants.rs`; a future PR swapping them
would compile and pass CI silently — code review of `constants.rs` diffs
is the only defense (see §7).

### NTT manager program

Trusted to correctly lock ONyc into custody on outbound and release on
inbound. Same `pub const` pinning treatment in `constants.rs`. Relayer
also encodes the positional `redeem_accounts_len` split that NTT
expects — see `InvalidAccountSplit` in `claim_usdc.rs`.

### OnRe program

Trusted to honor `take_offer_permissionless` semantics on the **deposit**
leg (`swap_usdc_to_onyc` CPIs `ONRE_TAKE_OFFER_IX` with the `Offer` PDA in
`remaining_accounts`): USDC in → ONyc out at the published price, plus
apply OnRe's own fee. The relayer does **not** blindly trust the ONyc
amount returned — it independently derives a NAV floor from the same
deposit `Offer` step price (`read_offer_nav_price` + `deposit_expected_out`
+ `slippage_bps`) and reverts `DepositSlippageBelowFloor` if the swap
under-delivers, plus a post-CPI `usdc_consumed == flow.amount` exact-spend
check. It then skims the deposit fee from the post-swap output to
`fee_vault`. This is the symmetric counterpart of the withdraw-leg floor.

On the **withdraw** leg the relayer does not use OnRe at all for the
conversion — OnRe redemptions are KYC-gated and the relayer PDA cannot
complete KYC. Instead `swap_onyc_to_usdc` routes the unlocked ONyc
through a third-party swap program (Jupiter today; the account layout is
aggregator-agnostic). OnRe's role shrinks to the **NAV-floor oracle**:
the handler reads the deposit `Offer` step price (`read_offer_nav_price`)
and rejects any fill below `gross_expected * (1 - slippage_bps)`
(`RedeemSlippageBelowFloor`). Three further layers bound the swap CPI: an
SPL `Approve` to exactly `flow.amount - fee` (the only spendable
surface), a post-CPI exact-consume assertion (`onyc_consumed ==
net_onyc`), and `assert_ata_untampered` on both ATAs — any
`SetAuthority`/`Approve` a malicious router smuggles in reverts the whole
transaction. **The swap program identity is not trusted**; safety rests
on the NAV floor plus these post-balance invariants. The only liveness
dependency is router liquidity above the floor — there is no
`redemption_admin` to stall and no cancel path.

### OnRe price-vector authority

A malicious or buggy price update could mint fewer wONyc shares than
deposits warrant (or more). Outside the relayer's control; mitigated by
OnRe's governance + the OnRe vault's defensive caps on per-block NAV
movement.

### OnRe deposit `Offer` active-vector liveness invariant

**Both** relayer legs derive their NAV from OnRe's deposit `Offer` PDA
(`[b"offer", usdc_mint, onyc_mint]`): the deposit swap prices off it, and
the withdraw swap reads it as the slippage floor (`onre.rs`
`read_offer_nav_price`). OnRe's own redemption prices off the *same*
account — `RedemptionOffer` holds no price, only a reference to this
`Offer` plus a fee — so this is the canonical NAV source, not a relayer
shortcut.

**Invariant: the deposit `Offer` must retain ≥1 active pricing vector
(`start_time != 0 && start_time <= now`) while any flow is in flight.**
If it has none, `read_offer_nav_price` reverts `OnreNoActiveVector` and
every `swap_usdc_to_onyc` / `swap_onyc_to_usdc` reverts — stranding the
flow's funds in the relayer's pooled ATA (deposit `Claimed` → USDC;
withdraw `Claimed` → ONyc).

This state is **not reachable by normal operation.** `add_offer_vector`
is append-only and activates immediately or in the future, so past
vectors accumulate and the latest stays active indefinitely. The OnRe
**kill switch does not** trigger it — it blocks `take_offer`/`fulfill`
CPIs but leaves the vectors (and the relayer's raw-account read) intact.
The only way to reach no-active-vector is a deliberate OnRe-**boss**
`delete_all_offer_vectors` / `delete_offer_vector` (offer
teardown/migration).

**Mitigations:** (1) there is no pre-built on-chain recovery path; a
permanent strand requires an upgrade-authority rescue (see the
incident-response table). (2) The cranker exposes
`cranker_flow_stuck{state="poisoned"}` — a flow quarantined after the
retry threshold (~2h of escalating failures) increments it; alert on any
nonzero value so an operator sees a strand within minutes rather than
from a user report.

## 4. Attack surface — what each compromised key can do

### 4.1 Compromised upgrade authority

**Blast radius: TOTAL.** The attacker can ship a new relayer `.so` that
ignores every safety check below. They can drain the relayer's
authority-owned USDC and ONyc ATAs, redirect outbound transfers to any
address, and forge Flow PDAs to defraud the FOGO-side vault.

**Mitigations:**

- Set upgrade authority to `None` (immutable) at deploy, OR transfer to
  a hardware-backed multisig with public threshold.
- Never leave on a single hot key. See `deploy-checklist.md` §2.

### 4.2 Malicious / arbitrary caller of a flow instruction

**Blast radius: ~ZERO.** The flow instructions are permissionless — any
wallet can submit them, and that's by design. Every safety-critical input
(`fogo_sender`, `ntt_inbox_item`, the in-flight token
amount) is parsed from a guardian-signed VAA or a CPI-created bridge PDA,
not from a caller-supplied parameter. The caller cannot:

- Choose the outbound recipient — `lock_onyc` and `send_usdc_to_user`
  read `flow.fogo_sender` (parsed from the VAA on `claim_usdc` /
  `unlock_onyc`), not a parameter.
- Forge a Flow PDA — Flow seeds include the NTT manager's CPI-created
  inbox-item PDA; nobody can create that without first feeding a real
  guardian-signed VAA through NTT.
- Skip or reorder the steps — `swap_usdc_to_onyc` requires `flow.status
  == Claimed` and transitions to `Swapped`; `lock_onyc` requires
  `Swapped`. Each handler emits an `emit!` event so misordered attempts
  are visible on-chain.
- Drain the long-lived USDC / ONyc ATAs — the relayer authority PDA
  signs all CPIs; an external wallet has no signing power over PDAs.
- Pocket the fee — fees are routed to the configured `fee_vault` (set
  by the config authority at `initialize` / `configure` time), not to
  the caller.

**Worst case from a malicious caller:**

- Submit junk transactions that fail and burn their own SOL.
- Race a legitimate caller to crank a flow (no harm — outcome is the
  same; the loser pays a failed-tx fee).
- Reclaim rent from a Flow PDA they themselves paid for after the flow
  completes (this is the normal close path; rent is returned to
  whichever wallet originally paid for the PDA).

A caller paying for a Flow PDA on someone else's deposit cannot
withhold rent reclamation maliciously — `lock_onyc` / `send_usdc_to_user`
close the PDA atomically with the final CPI, returning rent to the
original payer. The original payer's wallet is recorded in the Flow PDA
at init time.

This is the system's headline property. It depends on §4.1 holding —
if the attacker has the upgrade authority, none of this matters.

### 4.2.5 Compromised config authority

**Blast radius: BOUNDED.** The config authority is set at `initialize`
and rotatable only via `configure`. No instruction in the program lets
the authority sign for `usdc_ata` / `onyc_ata` outflows — operating
ATAs are touchable only by the flow-handler chain, bound to specific
`Flow` PDAs. A compromised config authority can:

- **Set fees up to `MAX_FEE_BPS` (10%) per leg.** `validate()` rejects
  any value above the constant on both live and staged fields, so the
  worst case is 10% per leg / ~19% round-trip. Increases require the
  `FEE_TIMELOCK_SLOTS` (~2 days) timelock; decreases apply instantly.
- **Redirect `fee_vault` to an attacker-controlled account.** The fee
  vault is an account address stored in config; rotation applies
  immediately. All subsequent fee skims (capped at 10%) flow to the
  new vault.
- **Loosen swap slippage tolerance up to `MAX_SLIPPAGE_BPS` (2%).**
  `slippage_bps` is authority-tunable and applies to both swap legs;
  `validate()` caps it at the constant. Maxed out, swaps may fill up to
  2% below the OnRe NAV floor — the worst-case griefing surface on the
  swap path. Unlike fee increases, it has no timelock (applies
  immediately).

**What the config authority CANNOT do:**

- **Drain operating ATAs.** No instruction in the program lets the
  authority sign for `usdc_ata` / `onyc_ata` outflows. The
  `relayer_authority` PDA is signed for only by handler-chain logic
  bound to specific `Flow` PDAs.
- **Bypass `MAX_FEE_BPS`.** `validate()` enforces the cap at every
  configure call, on both live and staged fields.
- **Redirect a specific flow's outbound recipient.** `lock_onyc` and
  `send_usdc_to_user` read `flow.fogo_sender` (parsed from the VAA at
  `claim_usdc` / `unlock_onyc` time), not from config.
- **Forge a Flow PDA or skip status guards.** Those are enforced by
  the program logic, not by config.
- **Replace the program.** That requires the upgrade authority (§4.1).

**Rotation:** Two-step propose/accept, designed for multisig → multisig
handoff where the two parties cannot easily co-sign one transaction.

1. **Propose** — current authority calls
   `configure(new_authority=Some(pk))`. This writes `pk` to
   `config.pending_authority`; `config.authority` is unchanged.
   Re-proposing overwrites the prior pending value.
   `Some(Pubkey::default())` cancels any in-flight proposal
   (clears `pending_authority` to `None`).
2. **Accept** — the proposed key signs `accept_authority` in a
   separate transaction. The handler verifies the signer equals
   `pending_authority`, then atomically copies pending into
   `authority` and clears the pending slot. The current authority
   does not participate.

This design **eliminates the typo-brick class**: a typo in step 1
just sits in the pending slot until either the current authority
overwrites/cancels it, or somebody who happens to control the typoed
key signs `accept_authority`. Until step 2 succeeds, the current
authority retains full control.

A compromised config authority can still rotate to an attacker-controlled
key by proposing the attacker's key and waiting for the attacker to
accept. This both **locks the legitimate operator out** and survives
any subsequent revocation of the original compromised key. The
fund-loss blast radius is bounded by `MAX_FEE_BPS` (≤10% per leg) and
the fee timelock; recovery from operator-lockout requires an
upgrade-authority redeploy.

**Mitigations:**

- Set the config authority to a hardware-backed multisig at
  `initialize` time. The same multisig that holds the upgrade
  authority is the natural choice — there is no operational reason to
  separate them, and using the same one avoids the "compromise either
  one is total" footgun.
- Never leave on a single hot key. While the cap and timelock bound
  the per-cycle damage, an attacker who holds the authority for an
  extended period can still siphon up to 10% of every flow until
  noticed.
- For a planned rotation: after step 1, **fetch on-chain config and
  verify `pending_authority` matches the intended successor** before
  the successor signs `accept_authority`. The two-step design lets you
  catch a misproposal before it commits.

### 4.3 Compromised OnRe price-vector authority

**Blast radius: NAV manipulation.** The attacker can update the ONyc
price to mint inflated wONyc shares to depositors (or deflated ones,
gating withdrawals).

**Mitigations:** outside this repo. Belongs to OnRe + the OnRe vault
program's defensive NAV caps. Documented here so the on-call knows the
key exists.

### 4.4 Compromised NTT manager admin

**Blast radius: rate-limit changes.** The admin can raise or lower NTT
rate limits, which throttles legitimate flows but cannot redirect them.
A malicious admin could DoS the relayer by setting limits to zero.

**Mitigations:** outside this repo (Wormhole + OnRe operational
security). The relayer fails closed when NTT rejects a transfer for
rate-limit reasons.

### 4.5 Compromised Wormhole guardians (≥13-of-19)

**Blast radius: cross-chain inbound flows can be forged.** The attacker
can craft a VAA that the bridge will accept; the relayer will then
mint+lock+credit a FOGO recipient of the attacker's choosing. The
relayer cannot defend against this — it inherits the trust of the
underlying bridge.

**Mitigations:** Wormhole's own guardian-set governance. The fogo-onre
vault may layer additional defenses (e.g., per-block deposit caps).

## 5. Replay protection

Two independent layers:

1. **Bridge-side**: NTT creates an `inbox_item` PDA on `redeem` (USDC
   inbound) and on outbound delivery. It is init-once and serves as the
   bridge's own replay protection.
2. **Relayer-side**: every Flow PDA is `init` (not `init_if_needed`)
   with seeds bound to the bridge PDA from layer 1. A second
   `claim_usdc` for the same VAA fails with the system program's
   `already in use` error before any CPI runs. This is asserted by
   `claim_usdc rejects replay when inflight Flow PDA already exists`
   in `tests/relayer.test.ts`.

A bug in either layer alone would not enable replay. Both must fail
simultaneously.

## 6. Fee-math safety

`apply_fee_bps` (`programs/relayer/src/state.rs`) widens to `u128`
before multiplication and uses `checked_mul` / `checked_sub` throughout.
The fee BPS is bounded at config time by `FeeBpsTooHigh` (max
`MAX_FEE_BPS = 1000` = 10%). Net amount is required `> 0` after fee
application — zero-amount flows are explicitly rejected.

A future change that swaps `checked_mul` for `*` or removes the u128
widening would silently allow overflow. There is no test that asserts
on the panic-free property; reviewers must catch this in PR review.

## 7. CPI allowlist (compile-time pinning only)

The relayer's CPI destinations are hardcoded `pub const Pubkey` values
in `programs/relayer/src/constants.rs`. This gives:

- **Compile-time pinning** — the program ID is baked into the `.so`,
  not loaded from an account. No way to redirect at runtime.

That is the _only_ defense. There is no automated CI alarm on changes
to these constants. A malicious PR that swaps a CPI destination would
compile, pass clippy, pass every other test, and ship — protection
relies entirely on a human reviewer noticing the diff in `constants.rs`.

**Reviewer responsibilities for any PR touching `constants.rs`:**

- Diff every changed `pub const Pubkey` against the canonical mainnet
  source (Wormhole / OnRe / NTT docs linked in each const's doc
  comment).
- Diff every changed instruction tag / sighash against the upstream
  program's IDL or source.
- A typo in the constants is indistinguishable from sabotage at this
  layer — when in doubt, block the PR and ask the author for the
  canonical source URL.

The on-chain program re-validates account _owners_ and _addresses_ via
Anchor constraints, so SDK-side drift cannot land funds at a wrong
destination — but if the on-chain `pub const` itself is swapped, the
program would happily CPI into the wrong place. There is no further
runtime check.

## 8. What this model does NOT cover

- **The FOGO-side OnRe vault program.** Its security model is documented
  separately. The relayer assumes the vault correctly accounts for
  reserve + ONyc backing and computes NAV defensively.
- **The bridge programs themselves.** Wormhole NTT and OnRe
  are external dependencies; the relayer trusts their published
  semantics.
- **Off-chain monitoring.** Whoever chooses to crank flows is responsible
  for their own infrastructure (alerting on stuck flows, retry logic).
  No on-chain role exists for them. The reference cranker surfaces
  `cranker_flow_stuck{state="poisoned"}` as the stuck-flow alert signal.
- **Economic attacks.** MEV ordering between `claim_usdc` and the
  swap, oracle manipulation of the OnRe price vector, etc., are out
  of scope.

---

## Quick reference for incident response

| Symptom                                               | Likely cause                                                                                                                 | First action                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `constants.rs` diff in PR review                      | Possible CPI redirection (intentional or malicious)                                                                          | Diff every changed `pub const Pubkey` and instruction tag against the canonical source linked in each const's doc comment. There is no automated test catching this — reviewer attention is the only line of defense.                                                                                                                          |
| Flow PDA stuck in `Claimed`                           | Swap CPI not yet done. Deposit: `swap_usdc_to_onyc` (OnRe price vector stale, NTT/OnRe rate limit, OnRe paused). Withdraw: `swap_onyc_to_usdc` (router lacks ONyc→USDC liquidity above the NAV floor, or the OnRe deposit `Offer` has no active vector)                                           | Diagnose the upstream condition. Re-crank the matching swap permissionlessly once it clears — funds remain in the relayer's authority-owned ATA (USDC on deposit, ONyc on withdraw) and resume on the next successful swap. No cancel path; recovery is "wait for upstream + retry".                                                                                             |
| Flow PDA stuck in `Swapped`                           | NTT send CPI not yet completed (rate limit, custody/outbox account state) — either leg | Deposit: re-crank `lock_onyc`. Withdraw: re-crank `send_usdc_to_user`. Check the NTT outbound rate limit first; both re-crank permissionlessly once it clears. No cancel path on either side.                                                                                                                                                    |
| `already in use` error on `claim_usdc`                | Replay attempt OR legitimate retry of a flow already created                                                                 | Inspect the existing Flow PDA — if it's at `Claimed`/`Swapped` for the same VAA, this is normal idempotence. No double-spend possible because the NTT `inbox_item` PDA is also init-once.                                                                                                                                          |
| Permanently stuck flow (upstream broken indefinitely) | OnRe / NTT discontinued, frozen mint, etc.                                                                                   | **There is no on-chain recovery path.** Funds in the in-flight ATAs require an upgrade-authority action (deploy a patched program with a one-shot rescue instruction, or migrate state to a new program). This is a known limitation of the v1 relayer — see `deploy-checklist.md` §6 for the OnRe/NTT availability assumptions this rests on. |
| Upgrade authority compromised                         | Per §4.1 — emergency                                                                                                         | If immutable: not possible. If multisig: revoke compromised signer; freeze deploys.                                                                                                                                                                                                                                                            |
