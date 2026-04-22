# Pre-Deploy Checklist

This is the **mandatory** human-action checklist before deploying the relayer
program to mainnet. Every item here is something CI **cannot** verify on its
own — they require a deployer decision, a manual key handling step, or
real-network verification.

If you cannot truthfully tick a box, **do not deploy**.

---

## 1. Build & verify the binary

- [ ] Run `anchor build --verifiable` and confirm the resulting `.so` hash
      matches what gets uploaded to mainnet. The verifiable build pins the
      Rust toolchain inside a Docker container; this guards against the
      deployer's local Rust version producing a different binary than CI.
      *(Skipped during the Apr 2026 test-tightening sprint — must be done
      before deploy.)*
- [ ] Compare the program ID embedded in the binary (`anchor keys list`)
      to the canonical `Re1ayRHhmeqByGjgT5uLFExZCvQ8sv6LK74xowK8pJH` in
      `Anchor.toml` and `programs/relayer/src/lib.rs`. They MUST match.
- [ ] Run `cargo test -p fogo-relayer --lib` and confirm all unit tests
      pass.
- [ ] **Manually diff `programs/relayer/src/constants.rs`** in the deploy
      commit against the previous release. There is no automated CI
      alarm on changes to the CPI program IDs or instruction tags — a
      malicious or accidental swap would compile and ship silently.
      Verify every `pub const Pubkey` against the canonical mainnet
      source linked in its doc comment.

## 2. Upgrade authority

The relayer program is the system's trust anchor. Whoever holds the upgrade
authority can ship a new `.so` that bypasses every safety property in this
codebase (CPI allowlist, flow-status guards, fee math).

Choose ONE before deploy:

- [ ] **Immutable**: set upgrade authority to `None`
      (`solana program set-upgrade-authority --final ...`).
      No future patches possible — bugs require redeploying under a new
      program ID and migrating state. Highest assurance.
- [ ] **Multisig**: transfer upgrade authority to a Squads (or equivalent)
      multisig with ≥3-of-5 hardware-key signers and a public threshold.
      Document the signer roster in this file before deploy.
- [ ] **NEVER** leave upgrade authority on a single hot/warm key.

Selected option: ___________________________
Multisig address (if applicable): ___________________________
Signer roster (if applicable): ___________________________

### 2b. Config authority

The `config authority` (set at `initialize`, rotatable only via `configure`)
has **near-total blast radius on operating balances**: it can `sweep`
arbitrary amounts of USDC and ONyc out of the relayer-owned ATAs, set
fees to 100%, and redirect `fee_vault` to an attacker-controlled
account. See `SECURITY_MODEL.md` §4.2.5 for the full attack surface.

Treat this key with the **same handling as the upgrade authority**:

- [ ] **Multisig**: transfer config authority to a Squads (or equivalent)
      multisig with ≥3-of-5 hardware-key signers. The natural choice is
      the **same multisig** as the upgrade authority — there is no
      operational reason to separate them, and reusing it avoids the
      "either one alone is total" footgun.
- [ ] **NEVER** leave config authority on a single hot/warm key, even
      "temporarily" during ramp-up.
- [ ] Confirm the rotation procedure is understood by all signers:
      two-step propose/accept. Step 1: current authority calls
      `configure(new_authority=Some(pk))` — writes `pending_authority`,
      does NOT change `authority`. Step 2: the proposed key signs
      `accept_authority` (separate tx, no current-authority
      participation). After step 1 and **before** step 2, fetch the
      on-chain config and verify `pending_authority` matches the
      intended successor. A typoed proposal can be cancelled by
      passing `Some(Pubkey::default())` to `configure` or simply
      overwritten with another `configure` call — the current
      authority is in control until step 2 completes.

Config authority address: ___________________________
Same as upgrade authority? (Y/N): ___________________________

## 3. External security audit

The CPI flow into Wormhole Gateway / NTT / OnRe is the most novel surface
and the highest-impact place for subtle bugs. An external audit MUST review
at minimum:

- [ ] CPI allowlist (`programs/relayer/src/constants.rs`) — every program
      ID and instruction discriminator verified against canonical sources.
      **There is no automated test catching drift here**; the audit must
      manually verify each constant.
- [ ] `claim_usdc` positional account-binding guards (line 71-82) — defends
      against VAA-substitution between the named `posted_vaa` slot and the
      one TB reads positionally from `remaining_accounts`.
- [ ] `apply_fee_bps` overflow safety (`state.rs`) — checked u128 widening
      before multiplication.
- [ ] `init` constraints on every Flow PDA — confirm replay protection
      cannot be bypassed by passing a different bump or seed permutation.
- [ ] Outbound recipient is bound to `flow.fogo_sender` (parsed from a
      guardian-signed VAA), NOT a caller-supplied parameter. Since the
      flow instructions are permissionless (any wallet can crank), the
      caller MUST be unable to redirect transfers. Confirmed.
- [ ] NTT session-authority delegation in `lock_onyc` — confirm the
      keccak-of-args binding prevents cross-call PDA reuse.

Audit firm: ___________________________
Report URL: ___________________________
Findings closed: ___________________________

## 4. Fixture / mainnet schema re-verification

`tests/utils/` ships pinned mainnet account fixtures (TB Config, MintSigner,
NTT Config, OnRe State, etc.) captured during development. If the upstream
program ships a state migration between fixture-capture and our deploy, the
relayer's parsing offsets will silently drift.

- [ ] Re-fetch each fixture from current mainnet (`solana account <pubkey>
      --output json`) and diff against `tests/utils/fixtures/*.json`.
      Layout changes require updating the parser AND re-running the LiteSVM
      e2e suite.
- [ ] Confirm Wormhole Core Bridge / Gateway / NTT / OnRe program IDs
      in `constants.rs` still resolve to deployed (non-frozen) programs on
      mainnet (`solana program show <pubkey>`).
- [ ] Re-verify the Wormhole chain ID for FOGO is still `51`.

## 5. NTT rate-limit production values

The LiteSVM tests zero out the rate-limit timestamps to make the fixtures
testable. In production, the on-chain NTT config enforces:

- [ ] **Outbound rate limit**: per-call cap and per-24h cap configured by
      the NTT manager admin. Confirm with the NTT operator that current
      values match the relayer's expected throughput. Document the active
      values:

      Per-call cap: ______________ ONyc
      Per-24h cap:  ______________ ONyc

- [ ] **Inbound rate limit**: same — confirm and document.

      Per-call cap: ______________ ONyc
      Per-24h cap:  ______________ ONyc

## 6. OnRe pricing-vector authority

The vault NAV depends on the OnRe price vector. Cached parameters update
rarely via Wormhole Queries or governance.

- [ ] Confirm who holds the price-vector update authority on the OnRe
      State PDA (mainnet). Document the address and any timelock /
      multisig structure.
- [ ] Confirm the relayer (and downstream OnRe vault) handles a frozen /
      stale price vector gracefully — either by failing closed or by
      pausing new deposits/withdrawals.

Update authority: ___________________________
Timelock / multisig: ___________________________

## 7. Devnet soak test

A handful of LiteSVM tests don't substitute for real-network multi-block
behavior (rent reclamation, slot transitions, NTT message attestation
windows).

- [ ] Deploy to devnet under the same upgrade-authority arrangement
      planned for mainnet.
- [ ] Run **at least 10** end-to-end deposit cycles (FOGO → claim_usdc →
      swap → lock_onyc) and **at least 10** end-to-end withdrawal cycles
      (FOGO → unlock_onyc → swap → send_usdc_to_user) over **at least
      72 hours**. Confirm:
      - All Flow PDAs close cleanly with rent returned to the original payer
      - No orphaned Flow PDAs after replay attempts
      - NTT rate-limit accumulators behave as expected across the
        24-hour window
      - Wormhole guardian attestation latency does not produce stuck flows
- [ ] Run a **failure-injection** pass on devnet: deliberate replay,
      wrong VAA, mismatched flow status. Confirm every failure surfaces
      a deterministic Anchor error and the relayer never partially
      mutates state.

## 8. Cranking infrastructure (no privileged key)

`claim_usdc`, `swap_*`, `lock_onyc`, `unlock_onyc`, `send_usdc_to_user`
are **permissionless** — anyone with enough SOL to pay the transaction
fee can call them, and that's by design. There is no operator / curator
key the system depends on. (See `SECURITY_MODEL.md` §4.2.)

What still needs to be decided before deploy:

- [ ] **Who runs the default cranker?** Pick one (or multiple — they
      can race harmlessly):

      - Off-chain bot operated by the deploying team (lowest latency,
        but creates a soft dependency).
      - Public bounty / MEV crank (anyone is incentivised to submit;
        no operational burden but unbounded latency on low-volume flows).
      - User self-crank in the SDK (each user pays for their own flow's
        rent and tx fees end-to-end).

      Selected approach: ___________________________

- [ ] **Whoever cranks pays rent for the Flow PDA.** The rent is
      returned to that same wallet when the flow closes (`lock_onyc`
      for deposits, `send_usdc_to_user` for withdrawals). Confirm the
      cranker has a SOL refill plan that covers the worst-case window
      between crank and close.
- [ ] **Stuck-flow alerting.** Whoever cranks is also responsible for
      noticing when a flow stalls (e.g. swap fails because the OnRe
      price vector is stale). There is no on-chain timeout. Document
      the monitoring runbook here:

      Alerting owner: ___________________________
      Stuck-flow SLO: ___________________________

## 9. CI / repo hygiene (informational)

These are known and benign as of the deploy snapshot but documented so the
on-call doesn't chase ghosts:

- The `bigint: Failed to load bindings, pure JS will be used` warning
  fires on every Node load of `@solana/spl-token`. It comes from the
  transitive `bigint-buffer` dep and is a benign perf fallback. Vitest
  hides it; raw `node` runs print it.
- `pnpm lint` reports ~2700 pre-existing `style/max-statements-per-line`
  errors. CI runs lint with `continue-on-error: true` until a dedicated
  lint-cleanup PR lands. None of these are correctness issues.
- `anchor build --verifiable` was deliberately skipped during the
  Apr 2026 hardening sprint and MUST be re-enabled in the deploy
  pipeline (see item 1).

---

## Sign-off

I, _______________________ (printed name),
acting as _______________________ (role),
confirm every applicable box above is ticked and certify this build is
ready for mainnet deploy.

Signature: ___________________________   Date: _______________
