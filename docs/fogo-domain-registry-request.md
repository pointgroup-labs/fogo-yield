# FOGO Labs: our intent-transfer fork is registered but its bridge still fails 0x4

## TL;DR

We run an `intent_transfer` **fork** (source-identical to yours, `declare_id!`
only) for our gasless deposit/withdraw bridge. On FOGO,
`intent_transfer.bridge_ntt_tokens` fails at the first `transfer_checked`
(source → intermediate) with SPL `0x4` ("owner does not match").

We verified on-chain that **our fork is already present in the DomainRegistry
for our domain** (`https://app.ignitionfi.xyz`), so registration is _not_ the
missing piece. The problem is a **PDA-seed mismatch between the lane that
authorizes a registered third-party program and the lane an unmodified
`intent_transfer` fork actually debits through**. We need confirmation of how
the bridge debit path is authorized, and what it would take to trust our fork
the same way your canonical program is trusted.

## Verified on-chain state (FOGO mainnet, `https://mainnet.fogo.io`)

Domain record for `https://app.ignitionfi.xyz` **exists**
(`EvzJGjgYGGc7hms44gLKeFsWrBdQ6m2VmEbpCEAcjjLH`, 320 B = 5 entries):

| program_id                                                   | registered signer_pda (`["fogo_session_program_signer"]`) |
| ------------------------------------------------------------ | --------------------------------------------------------- |
| `SP1s4uFeTAX9jsXXmwyDs1gxYYf7cdDZ8qHUHVxE1yr`                | `GUMw1EMauhkPjdYKPbonnitDSfJZYsvZrCBNb8cDDyjn`            |
| `LockvXm2nWht6EvHf44AmCuS3eMKRiWTuks2x27XRRo`                | `3AX1qQMHwzJS4TpLYPFLAg6WYiWrMTC8QDEY5PbWS4aF`            |
| `PyRon8FBSDSk6MxNKsZj2uZweBsa2nH5amyKnN6eN57`                | `7o5kwDMkvTzKCxLb4UH86GkKsLJirmTM8HeS4BZPjYRc`            |
| `vnt1u7PzorND5JjweFWmDawKe2hLWoTwHU6QKz6XX98`                | `3Kdtda8zcXjuC6n69xfuXtyZt2kEwLE6ghvubGbKfsFv`            |
| `inTFf5S7ZtYr8SkwGG85mjDwAyJwjqEPdH2p2nuyrL9` **(our fork)** | `433jJQoqq7wjWWx99sHWmPpuCNHfU8DeYoy9dcdbckse`            |

Note: the bare host `app.ignitionfi.xyz` (no scheme) has **no** record — only
the scheme-qualified `https://app.ignitionfi.xyz` does.

Our program PDAs (fork vs. your canonical):

|           | program_id        | `["intent_transfer"]` setter (used by `bridge_ntt_tokens`) | `["fogo_session_program_signer"]` (in registry) |
| --------- | ----------------- | ---------------------------------------------------------- | ----------------------------------------------- |
| Fork      | `inTFf5S7…nuyrL9` | `E11HNeVDA7ZMemjezZaqfWTfdyL1PVkDfLY4xj762wKx`             | `433jJQoqq7wjWWx99sHWmPpuCNHfU8DeYoy9dcdbckse`  |
| Canonical | `Xfry4dW9…GkARD`  | `EkYeW6iAtp2XsxsFZ2pDryf54qSND4RkGFCgMmX55vBL`             | `5vzwkMxtWEKwSvJAhQWwRvkWiVJjSTkDXmPB7w8ShapQ`  |

Your canonical program is **not** in our domain record, yet its bridge debits
the user's session-delegated source ATA successfully.

Relevant programs:

- DomainRegistry: `DomaLfEueNY6JrQSEFjuXeUDiohFmSrFeTNTPamS2yog`
- SessionManager: `SesswvJ7puvAgpyqp7N8HnjNnvpnS8447tKNF3sPgbC`

## The on-chain symptom

```
Program inTFf5S7ZtYr8SkwGG85mjDwAyJwjqEPdH2p2nuyrL9 invoke [1]
  Instruction: BridgeNttTokens
  Program 11111111111111111111111111111111 (System) success   # creates intermediate ATA
  Program Tokenkeg... InitializeAccount3 success
  Program Tokenkeg... TransferChecked
  Program log: Error: owner does not match
  Program Tokenkeg... failed: custom program error: 0x4
Program inTFf5S7... failed: custom program error: 0x4
```

The failing transfer is `source -> intermediate_token_account`, authority =
the executing program's `["intent_transfer"]` setter. Same code with the
canonical program succeeds; with our fork it returns `0x4`. The only delta is
the program id (hence a different setter PDA).

## Root cause (as far as we can determine)

`bridge_ntt_tokens` debits the source ATA with the program's
**`["intent_transfer"]`** setter — `E11HN…2wKx` for our fork. But the
DomainRegistry authorizes our fork under its **`["fogo_session_program_signer"]`**
PDA — `433jJ…ckse`. These are different addresses.

A verbatim `intent_transfer` fork _only_ ever signs token transfers with the
`["intent_transfer"]` seed; it has no code path that signs with
`fogo_session_program_signer`. So the registry entry records a PDA the fork
never presents, and the PDA it _does_ present (`E11HN…`) is not the
session-delegated/authorized one → `0x4`.

Your canonical program works without any registry entry, which tells us the
**bridge debit path is authorized by something other than the DomainRegistry's
`fogo_session_program_signer` lane** — most likely a direct trust of the
canonical `["intent_transfer"]` setter in the FOGO token program.

## What we need from you

1. **How is the `bridge_ntt_tokens` source-debit authorized?** Specifically,
   what makes the canonical `["intent_transfer"]` setter (`EkYeW6…`) an
   accepted authority over a user's session-delegated source ATA, given it is
   not in any domain record?

2. **Can our fork's `["intent_transfer"]` setter (`E11HN…2wKx`) be trusted the
   same way** your canonical setter is? If that trust is a hardcoded/global set
   in the FOGO token program (not the registry), adding our fork's setter to it
   is the operation we're asking for.

3. **Is the DomainRegistry lane usable for the bridge path at all** for an
   unmodified `intent_transfer` fork? If authorization requires the program to
   sign with its `fogo_session_program_signer` PDA, then a `declare_id!`-only
   fork can never satisfy it without code changes — please confirm so we stop
   pursuing the registry route.

## Interim posture on our side

Until our fork's `["intent_transfer"]` setter is trusted, our deposit and
withdraw send legs can route through your canonical `intent_transfer`
(`Xfry4dW9…`), which lands today. Our Solana relayer already accepts both the
canonical and fork setters (permanent allowlist), and our bridge fee accrues
via the paymaster domain/variation independent of which intent program runs —
so canonical routing is functionally complete for us; the fork is the
preferred end state, not a launch blocker.
