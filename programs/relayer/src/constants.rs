use anchor_lang::prelude::*;

pub const FOGO_WORMHOLE_CHAIN_ID: u16 = 51;

#[constant]
pub const ONRE_PROGRAM_ID: Pubkey = pubkey!("onreuGhHHgVzMWSkj2oQDLDtvvGvoepBPkqyaubFcwe");

#[constant]
pub const NTT_USDC_PROGRAM_ID: Pubkey = pubkey!("nttu74CdAmsErx5daJVCQNoDZujswFrskMzonoZSdGk");

#[constant]
pub const NTT_ONYC_PROGRAM_ID: Pubkey = pubkey!("nttpna5vXW7BN2Aa4AfTbkCncJWTEoBsnWvjS87Xgsd");

pub const NTT_TRANSFER_LOCK_IX: [u8; 8] = [179, 158, 146, 148, 151, 46, 176, 200];
pub const NTT_REDEEM_IX: [u8; 8] = [184, 12, 86, 149, 70, 196, 97, 225];
pub const NTT_RELEASE_INBOUND_UNLOCK_IX: [u8; 8] = [182, 162, 62, 206, 197, 137, 83, 98];

/// Wormhole Core Bridge program id (mainnet). Pinned for documentation /
/// future use by handlers that need to assert the wormhole-program account
/// the release CPI receives. The release CPI itself is dispatched via
/// `remaining_accounts`, so this constant isn't directly read by `lock_onyc`
/// — it exists so off-chain tooling and any future on-chain assertion share
/// one source of truth.
#[constant]
pub const WORMHOLE_CORE_PROGRAM_ID: Pubkey =
    pubkey!("worm2ZoG2kUd4vFXhvjh93UUH596ayRfgQ2MgjNMTth");

/// Discriminator for `release_wormhole_outbound` in the OnRe ONyc NTT
/// manager (v3.0.0 IDL — transceiver compiled into manager binary).
/// Equivalent to sha256("global:release_wormhole_outbound")[..8].
/// Sanity check: node_modules/.../sdk-solana-ntt/.../3_0_0/json/ntt_transceiver.json
pub const NTT_RELEASE_WORMHOLE_OUTBOUND_IX: [u8; 8] =
    [0xCA, 0x57, 0x33, 0xAD, 0x8E, 0xA0, 0xBC, 0xCC];

pub const ONRE_TAKE_OFFER_IX: [u8; 8] = [37, 190, 224, 77, 197, 39, 203, 230];

/// OnRe `create_redemption_request` sighash. Used by the asymmetric
/// withdraw chain — there's no permissionless atomic counterpart to
/// `take_offer_permissionless`, so we submit a request and poll for closure.
pub const ONRE_CREATE_REDEMPTION_REQUEST_IX: [u8; 8] = [201, 53, 181, 254, 115, 137, 70, 151];

/// Slot index for OnRe's `create_redemption_request.redemption_request`.
/// `request_redemption_onyc` reads this index from `ctx.remaining_accounts`
/// post-CPI; OnRe's `init` constraint has seed-validated it, so binding to
/// `tracker.redemption_request` is trustworthy without a second source of truth.
pub const ONRE_CREATE_REDEMPTION_REQUEST_REDEMPTION_REQUEST_INDEX: usize = 2;

/// OnRe `cancel_redemption_request` sighash. Authority-only escape hatch
/// invoked from `cancel_redemption_onyc` when an OnRe redemption is stuck.
pub const ONRE_CANCEL_REDEMPTION_REQUEST_IX: [u8; 8] = [77, 155, 4, 179, 114, 233, 162, 45];

/// Slot index for OnRe's `cancel_redemption_request.redemption_request`.
/// Pinned independently from the create-side index — OnRe could reorder
/// either struct without touching the other.
pub const ONRE_CANCEL_REDEMPTION_REQUEST_REDEMPTION_REQUEST_INDEX: usize = 2;

/// `RedemptionOffer` PDA seed under OnRe. Note: seed order is
/// `[seed, ONyc_mint, USDC_mint]` — the *opposite* of the deposit `Offer`
/// PDA (`[b"offer", USDC_mint, ONyc_mint]`). Don't reuse `OFFER_SEED` here.
pub const ONRE_REDEMPTION_OFFER_SEED: &[u8] = b"redemption_offer";

/// `RedemptionRequest` PDA seed: `[seed, redemption_offer, request_counter_le_u64]`.
pub const ONRE_REDEMPTION_REQUEST_SEED: &[u8] = b"redemption_request";

pub const ONRE_REDEMPTION_OFFER_VAULT_AUTHORITY_SEED: &[u8] = b"redemption_offer_vault_authority";

/// Singleton sidecar PDA seed: `[seed]`. Exactly one `RedemptionTracker`
/// can exist at a time, doubling as the in-flight mutex.
pub const REDEMPTION_TRACKER_SEED: &[u8] = b"redemption_tracker";

/// Needed for the NTT session-authority delegate handshake in `lock_onyc`
/// and `send_usdc_to_user`.
pub const SPL_TOKEN_APPROVE_IX_TAG: u8 = 4;

pub const RELAYER_SEED: &[u8] = b"relayer";
pub const CONFIG_SEED: &[u8] = b"relayer_config";

/// Minimum slot delay for fee *increases*. ≈ 2 days at 400ms slots.
pub const FEE_TIMELOCK_SLOTS: u64 = 432_000;

/// Hard ceiling on `deposit_fee_bps` / `withdraw_fee_bps`, enforced by
/// `RelayerConfig::validate()`. Capped at 10% to bound the worst-case
/// damage from a compromised authority key — without an upstream FOGO
/// vault to bound fees externally, this contract is the user-facing
/// trust boundary. Round-trip worst case: ~19% (`1 − 0.9²`).
pub const MAX_FEE_BPS: u16 = 1000;

pub const FLOW_INBOUND_SEED: &[u8] = b"inflight";
pub const FLOW_OUTBOUND_SEED: &[u8] = b"outflight";

/// Approved as SPL `Approve` delegate before NTT `transfer_lock`.
pub const NTT_SESSION_AUTHORITY_SEED: &[u8] = b"session_authority";

/// Per-user inbox authority PDA. Seeds = `[USER_INBOX_SEED, user_wallet]`
/// under the relayer program ID. The webapp signs an intent whose
/// `recipient_address` is this PDA, so the FOGO `intent_transfer.bridge_ntt_tokens`
/// emits a VAA addressed to it; NTT `release_inbound` then deposits USDC
/// into `getAssociatedTokenAddress(USDC_MINT, user_inbox_authority)`.
/// `claim_usdc` PDA-signs a sweep from that ATA into the relayer-authority
/// USDC ATA, recording `user_wallet` as `flow.fogo_sender` so the
/// downstream return leg (`lock_onyc` / `send_usdc_to_user`) bridges back
/// to the originating wallet on FOGO.
pub const USER_INBOX_SEED: &[u8] = b"user_inbox";

// CROSS-PROGRAM VERSION DEPENDENCY — FOGO `intent_transfer`
//
// SECURITY-CRITICAL: the two constants below are part of the trust
// chain that pins inbound USDC.s VAAs to the FOGO `intent_transfer`
// program. They are the *security keystone* of the deposit flow:
//
//   1. The webapp signs an intent whose `recipient_address` is the
//      per-user inbox PDA on Solana.
//   2. FOGO's `intent_transfer.bridge_ntt_tokens` consumes the intent
//      and bridges via NTT — the from-ATA owner inside that bridge is
//      the singleton PDA `[INTENT_TRANSFER_SETTER_SEED]` under
//      `INTENT_TRANSFER_PROGRAM_ID`.
//   3. That PDA surfaces as `NttManagerMessage.sender` on the VAA.
//   4. `claim_usdc` requires `sender == intent_transfer setter PDA`,
//      rejecting any direct (non-intent) NTT bridge to the same
//      recipient PDA.
//
// **Operational coupling:** if upstream `intent_transfer` ever rotates
// its setter PDA seed OR is redeployed at a different program ID,
// this relayer must be redeployed in lockstep. Until that redeploy
// lands, every inbound USDC.s deposit fails with `UnexpectedFogoSender`.
//
// Currently acceptable because: the relayer is upgradeable
// (BPFLoaderUpgradeable), and `intent_transfer` is governed by the
// same trust sphere — a coordinated upgrade is feasible.
//
// **DO NOT** make these runtime-rotatable via `RelayerConfig` without
// reviewing the threat model: a stolen authority key could then
// redirect the entire deposit flow to an attacker-controlled program.
// The compile-time constant is the trust-minimization boundary.
//
// See `docs/architecture.md` "Cross-program version dependencies".

/// FOGO `intent_transfer` program ID. Pinned so `claim_usdc` can require
/// that any incoming VAA was originated by intent_transfer (its singleton
/// `intent_transfer_setter` PDA is the NTT message sender for every
/// intent-driven bridge). Without this pin, a direct NTT bridge that
/// happens to target a user's inbox PDA would also satisfy the deposit
/// flow — annoying rather than dangerous, but the pin enforces the
/// intended deposit path.
#[constant]
pub const INTENT_TRANSFER_PROGRAM_ID: Pubkey =
    pubkey!("Xfry4dW9m42ncAqm8LyEnyS5V6xu5DSJTMRQLiGkARD");

/// Singleton-PDA seed inside `intent_transfer`. The PDA `[INTENT_TRANSFER_SETTER_SEED]`
/// under `INTENT_TRANSFER_PROGRAM_ID` is the `from.owner` of the
/// intermediate token account intent_transfer uses for `transfer_burn`,
/// so it surfaces as `NttManagerMessage.sender` on every intent-driven
/// VAA we receive.
pub const INTENT_TRANSFER_SETTER_SEED: &[u8] = b"intent_transfer";
