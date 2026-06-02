# Intent-fork cross-program replay: no principal theft, bounded fee leak

**Status:** accepted risk, no on-chain replay gate. Open Q5 from
`docs/tmp/superpowers/specs/2026-05-29-onre-intent-program-design.md`.

## The vector

Both legs (USDC deposit, ONyc redeem) route through
`intent_transfer.bridge_ntt_tokens`. The user signs an intent message and
a paymaster sponsor co-signs and lands the transaction. The intent
message does **not** bind the `sponsor`: nothing in the signed bytes names
who pays gas or submits the transaction.

The OnRe fork (`inTFf5S7ZtYr8SkwGG85mjDwAyJwjqEPdH2p2nuyrL9`) is
source-identical to Fogo's `intent_transfer`
(`Xfry4dW9m42ncAqm8LyEnyS5V6xu5DSJTMRQLiGkARD`) except `declare_id!`. The
relayer pins inbound NTT senders to a permanent two-element allowlist
`{OnRe-setter, Fogo-setter}` (`allowed_intent_setters()` in
`programs/relayer/src/constants.rs`) so a deposit/redeem that originated
through _either_ program is accepted on Solana.

So a third party who observes a user's signed intent can, before it
lands, try to replay it against the **dormant** program (Fogo's, which we
no longer route through) and become the sponsor. The relayer would accept
the inbound NTT message because the Fogo setter is allowlisted. But the
replay **fails at the user-token debit**: the fork debits `source` and
`fee_source` via Fogo's in-session token rail, not a global setter PDA.
That rail authorizes a non-owner mover only when the user's `Session`
both (a) has `session.user == source.owner` and (b) lists the _calling
program's_ program-signer PDA in its `authorized_programs`, proven by
that PDA being present-as-signer among the transfer's extra accounts
(`session_token::in_session_transfer_checked`). A replay routed through
the dormant Fogo program presents **Fogo's** program-signer PDA, which an
OnRe-domain session does not authorize, so the patched token program
rejects the debit (`0x4`/owner-mismatch) and no tokens move.

The earlier "setter family, forks included" framing — where any
intent-transfer fork's setter PDA could debit the session-delegated ATA —
was wrong: the session pins authorization to the **specific** program
whose signer it blessed, not to a fork family.

## The residual vector: same-program sponsor swap

The session rail closes cross-program replay. What remains is a replay
against the **active** fork itself with a different `sponsor`: the
program-signer matches, the session authorizes it, so the debit lands and
only the unpinned `sponsor` changes. The rest of this document bounds that
residual case.

## What the value flow actually is

The fee accounts pin who pays and who collects
(`bridge_ntt_tokens.rs:164-168`):

- `fee_source` — `token::authority = source.owner`: the **user** pays the
  bridge fee, out of the same balance as the bridged amount.
- `fee_destination` — `associated_token::authority = sponsor`: the
  **sponsor** collects it. In a replay the replayer _is_ the sponsor, so
  the replayer collects the fee.
- `fee_amount = fee_config.bridge_transfer_fee` — a fixed on-chain figure,
  identical whoever sponsors.

So a replayer does **not** pay the fee — the user does, and the replayer
banks it. A replayer's P&L is `+ bridge_transfer_fee − (FOGO gas + ATA/nonce
rent)`, which can be positive. The earlier "replayer pays and gains
nothing" framing was wrong on both counts.

## Why this is bounded — fee leak, not theft

1. **No principal theft — the recipient is the signed user inbox.** The
   NTT `recipient_address` is the per-user inbox PDA
   (`findUserInboxAuthorityPda(wallet, RELAYER_PROGRAM_ID)`), a field of
   the _signed_ message. A replay delivers to exactly the inbox the user
   signed for; the replayer cannot name themselves as recipient without
   invalidating the signature. **This is the load-bearing safety
   property** — user principal is never at risk regardless of who
   sponsors.

2. **The only asset a replay can divert is OnRe's fee revenue.** The user
   pays the same fee and receives the same funds either way, so the user
   is indifferent to a replay. The only party worse off is OnRe's
   sponsor, which loses that one transfer's fee to the replayer. The
   exposure is bounded to fee revenue, never user capital.

3. **A replay must win a nonce race it usually loses.** The on-chain nonce
   (`verify_and_update_nonce`, `stored + 1`) is consumed by whichever
   submission lands first. The genuine submission goes out immediately via
   OnRe's sponsor; if it lands first the replay fails `NonceFailure` and
   the replayer ate gas for nothing. The replayer is front-running OnRe's
   own sponsored transaction for a single fee — a negative-EV race in the
   common case.

4. **The signed intent isn't public before it lands.** The intent travels
   webapp → OnRe paymaster, not a public mempool, so an outside replayer
   generally cannot see the bytes in time to front-run. The realistic
   replay actor is a malicious/compromised sponsor, which is a separate
   trust assumption.

5. **Single-active-program sponsorship.** OnRe's paymaster sponsors only
   the active program (`FOGO_BRIDGE_PAYMASTER_DOMAIN` / `OnReBridge` shaped
   for the OnRe fork). It will not co-sponsor a submission shaped for the
   dormant program, so a replayer must fund the gas themselves — they get
   no sponsorship subsidy for the attempt.

6. **Backend already-used-intent guard.** The sponsor service refuses to
   co-sponsor an intent whose hash it has already sponsored, so it cannot
   be tricked into funding both the genuine submission and a replay.
   _(Ops/infra — see boundary below.)_

7. **Short intent validity.** Intents are sponsored only within a short
   window, so a captured-but-unlanded intent cannot be replayed later.
   _(Ops/infra — see boundary below.)_

8. **Replay monitoring.** The cranker flags any inbound VAA whose NTT
   sender is the dormant program's setter PDA
   (`cranker_intent_replay_observed_total{leg}`, emitted by
   `packages/cranker/src/relayer/replay-monitor.ts`). Under normal
   operation this counter stays at zero; any increment is a cross-program
   replay signal an operator alert fires on.

## Conclusion

The unpinned `sponsor` leaves two replay shapes. Cross-program replay
against the dormant Fogo program is **closed on-chain**: the session rail
debits user tokens only for the program whose signer the session
authorized, and an OnRe-domain session does not authorize Fogo's, so that
replay fails at the debit and moves nothing. The residual shape is a
same-program sponsor swap on the active fork; it cannot steal principal
(recipient is signed), the only asset it can divert is a single transfer's
fee revenue (from OnRe's sponsor to the replayer), and even that requires
winning a nonce race against OnRe's own immediate submission on bytes that
never hit a public mempool. An on-chain replay gate would add audited-fork
surface to defend a small, bounded, self-front-running fee leak with no
principal at stake. We therefore accept the risk without an on-chain gate,
backed by the monitoring metric.

## In-repo vs ops boundary

The argument leans on two controls that live outside this repository and
are owned by whoever operates the paymaster/sponsor:

- **Backend already-used-intent guard (6)** — there is no sponsor or
  paymaster backend in this monorepo (packages are `cli`, `cranker`,
  `sdk`, `webapp`; the sponsor is Fogo Labs' external paymaster reached
  via `/api/sponsor_pubkey`). The hash-dedupe guard and its test must
  land in that service. This document is the requirement.

- **Short intent expiries (7)** — the signed intent message format is
  byte-pinned to the upstream parser (`version: 0.2`, see
  `packages/sdk/src/builders/intent-transfer.ts::buildBridgeOutIntentMessage`)
  and carries **no** expiry/`valid_until` field. Adding one would break
  the audited on-chain `BridgeMessage::TryFrom` parser. Expiry is
  therefore enforced at the **sponsor layer** — the sponsor refuses to
  co-sign an intent older than its window — not in the message.

- **Replay monitoring (8)** — this one **is** in-repo:
  `cranker_intent_replay_observed_total{leg}` in
  `packages/cranker/src/relayer/replay-monitor.ts`, wired into both
  `claim-usdc.ts` (deposit) and `unlock-onyc.ts` (withdraw). Add a
  Prometheus alert on `increase(cranker_intent_replay_observed_total[1h]) > 0`.
