use anchor_lang::prelude::*;

/// OnRe program (Solana mainnet).
/// Source: <https://github.com/onre-finance/onre-sol>
pub const ONRE_PROGRAM_ID: Pubkey = pubkey!("onreuGhHHgVzMWSkj2oQDLDtvvGvoepBPkqyaubFcwe");

/// Wormhole Core Bridge (Solana mainnet).
/// Owner of posted-VAA accounts — used to validate `posted_vaa` in `claim_usdc`.
/// Source: <https://wormhole.com/docs/products/reference/contract-addresses/>
pub const WORMHOLE_CORE_BRIDGE_ID: Pubkey = pubkey!("worm2ZoG2kUd4vFXhvjh93UUH596ayRfgQ2MgjNMTth");

/// Wormhole Portal Token Bridge (Solana mainnet).
/// Handles USDC bridging via `CompleteWrappedWithPayload` / `TransferWrappedWithPayload`.
/// Source: <https://wormhole.com/docs/products/reference/contract-addresses/>
pub const GATEWAY_PROGRAM_ID: Pubkey = pubkey!("wormDTUJ6AWPNvk59vGQbDvGJmqbDTdgWgAqcLBCgUb");

/// Wormhole NTT Manager (Solana mainnet) — Locking mode.
/// ONyc is canonical on Solana (issued by OnRe), so the NTT manager locks
/// outbound ONyc into custody and releases (not mints) on inbound.
/// Handles ONyc bridging via `transfer_lock` / `redeem` / `release_inbound_unlock`.
/// Source: <https://github.com/wormhole-foundation/native-token-transfers>
pub const NTT_PROGRAM_ID: Pubkey = pubkey!("nttu74CdAmsErx5daJVCQNoDZujswFrskMzonoZSdGk");

// Outbound FOGO recipient model (Phase 1):
// There is no single pinned recipient. Each inbound VAA (Gateway claim or
// NTT redeem) carries the originating FOGO user wallet in its payload.
// `claim_usdc` / `unlock_onyc` parse that payload and persist the address
// to a `Flow` PDA seeded by the bridge's per-VAA claim account pubkey.
// `lock_onyc` / `send_usdc_to_user` then consume that PDA and use its
// stored `fogo_sender` as the outbound Wormhole recipient. A stolen
// operator key cannot forge a claim PDA (it's CPI-created by the bridge
// program) and therefore cannot redirect outbound transfers.

/// Wormhole chain ID for FOGO.
/// Source: <https://wormhole.com/docs/products/reference/chain-ids/>
pub const FOGO_WORMHOLE_CHAIN_ID: u16 = 51;

// Portal Token Bridge — Solitaire-style single-byte Borsh enum variant tags.
// Instruction enum order: Initialize(0), AttestToken(1), CompleteNative(2),
// CompleteWrapped(3), TransferWrapped(4), TransferNative(5), RegisterChain(6),
// CreateWrapped(7), UpgradeContract(8), CompleteNativeWithPayload(9),
// CompleteWrappedWithPayload(10), TransferWrappedWithPayload(11),
// TransferNativeWithPayload(12).
//
// We use CompleteWrappedWithPayload to claim inbound USDC from FOGO, and
// TransferWrappedWithPayload to send USDC back to a FOGO user.
pub const GATEWAY_COMPLETE_TRANSFER_IX: [u8; 1] = [10];
pub const GATEWAY_TRANSFER_OUT_IX: [u8; 1] = [11];

// Wormhole NTT — 8-byte Anchor sighashes: sha256("global:<name>")[..8].
// Locking mode (canonical token on Solana):
//   transfer_lock (outbound) + release_inbound_unlock (inbound).
// `redeem` is the same instruction in both modes (it just records the VAA
// into an inbox item; release happens in the second CPI).
pub const NTT_TRANSFER_LOCK_IX: [u8; 8] = [179, 158, 146, 148, 151, 46, 176, 200];
pub const NTT_REDEEM_IX: [u8; 8] = [184, 12, 86, 149, 70, 196, 97, 225];
pub const NTT_RELEASE_INBOUND_UNLOCK_IX: [u8; 8] = [182, 162, 62, 206, 197, 137, 83, 98];

// OnRe — 8-byte Anchor sighash for `global:take_offer_permissionless`.
pub const ONRE_TAKE_OFFER_IX: [u8; 8] = [37, 190, 224, 77, 197, 39, 203, 230];

// SPL Token program — single-byte instruction tags from the canonical
// `TokenInstruction` enum. We only need `Approve` (tag 4) for the NTT
// session-authority delegate handshake in `lock_onyc`.
// Source: <https://github.com/solana-program/token/blob/main/program/src/instruction.rs>
pub const SPL_TOKEN_APPROVE_IX_TAG: u8 = 4;

// ---------------------------------------------------------------------------
// PDA seeds
// ---------------------------------------------------------------------------

/// Seed for the relayer authority PDA that owns all long-lived token
/// accounts and signs outbound CPIs.
pub const RELAYER_SEED: &[u8] = b"relayer";

/// Seed for the Token Bridge redeemer PDA used only by
/// `claim_usdc` (CompleteWrappedWithPayload). TB requires the redeemer to
/// sign AND checks that the inbound token account's owner equals either
/// `vaa.to` (the receiver program id) or the redeemer PDA itself. We
/// therefore keep the redeemer as its own PDA and use a short-lived
/// redeemer-owned USDC ATA as the TB `to` account; the instruction then
/// sweeps USDC from that intake ATA into the main authority-owned USDC
/// ATA in the same transaction.
pub const REDEEMER_SEED: &[u8] = b"redeemer";

/// Seed for the relayer config PDA.
pub const CONFIG_SEED: &[u8] = b"relayer_config";

/// Seed prefix for inbound flow PDAs (deposit leg: USDC → ONyc → bONyc
/// back to FOGO user). Full seeds: `[FLOW_INBOUND_SEED, claim_pda.key()]`.
pub const FLOW_INBOUND_SEED: &[u8] = b"inflight";

/// Seed prefix for outbound flow PDAs (withdrawal leg: bONyc → ONyc →
/// USDC back to FOGO user). Full seeds: `[FLOW_OUTBOUND_SEED, inbox_pda.key()]`.
pub const FLOW_OUTBOUND_SEED: &[u8] = b"outflight";

/// NTT session-authority PDA seed prefix. NTT derives a per-call PDA as
/// `[NTT_SESSION_AUTHORITY_SEED, sender, keccak(transfer_args)]` under
/// `NTT_PROGRAM_ID`. We must approve this PDA as SPL `Approve` delegate
/// before invoking `transfer_lock`.
/// Source: NTT manager `transfer_lock` / `transfer_burn` account derivation.
pub const NTT_SESSION_AUTHORITY_SEED: &[u8] = b"session_authority";
