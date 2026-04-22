#![allow(clippy::diverging_sub_expression)]

use anchor_lang::prelude::*;

pub mod constants;
pub mod cpi;
pub mod error;
pub mod events;
pub mod instructions;
pub mod ntt;
pub mod onre;
pub mod state;
pub mod vaa;

use instructions::*;

declare_id!("Re1ayRHhmeqByGjgT5uLFExZCvQ8sv6LK74xowK8pJH");

/// Stateless cross-chain relayer between FOGO and Solana (Phase 1 — no
/// vault).
///
/// All operational instructions are permissionless — anyone can crank any
/// step. Safety comes from the Flow PDA design: each inbound Wormhole
/// message (Gateway VAA or NTT VAA) carries the originating FOGO user's
/// wallet in its payload. `claim_usdc` / `unlock_onyc` persist that wallet
/// in a one-shot `Flow` PDA keyed by the bridge's per-VAA claim account
/// pubkey; `lock_onyc` / `send_usdc_to_user` then consume that PDA to
/// choose the outbound recipient. The Flow PDA also tracks status and
/// amount, isolating concurrent flows and enabling resumability.
#[program]
pub mod relayer {
    use super::*;

    /// One-time setup: create the relayer config PDA + USDC/ONyc ATAs
    /// owned by the relayer authority PDA.
    pub fn initialize(
        ctx: Context<Initialize>,
        deposit_fee_bps: u16,
        withdraw_fee_bps: u16,
    ) -> Result<()> {
        initialize::handler(ctx, deposit_fee_bps, withdraw_fee_bps)
    }

    // ── Deposit leg: FOGO user → Solana → back to FOGO user ─────────

    /// Claim USDC bridged from a FOGO user via Wormhole Gateway. Creates
    /// a `Flow` receipt that binds the eventual bONyc return to that same
    /// user's FOGO wallet.
    pub fn claim_usdc<'info>(ctx: Context<'info, ClaimUsdc<'info>>) -> Result<()> {
        claim_usdc::handler(ctx)
    }

    /// Swap the flow's USDC amount into ONyc via OnRe.
    pub fn swap_usdc_to_onyc<'info>(ctx: Context<'info, SwapUsdcToOnyc<'info>>) -> Result<()> {
        swap_usdc_to_onyc::handler(ctx)
    }

    /// Lock the flow's ONyc amount via Wormhole NTT, sending bONyc back
    /// to the FOGO wallet recorded in the `Flow` PDA. Consumes the PDA.
    pub fn lock_onyc<'info>(ctx: Context<'info, LockOnyc<'info>>) -> Result<()> {
        lock_onyc::handler(ctx)
    }

    // ── Withdrawal leg: FOGO user → Solana → back to FOGO user ──────

    /// Release ONyc from NTT custody for an inbound withdrawal VAA, and
    /// record a `Flow` receipt binding the USDC return to the FOGO user
    /// who initiated the withdrawal.
    pub fn unlock_onyc<'info>(
        ctx: Context<'info, UnlockOnyc<'info>>,
        redeem_accounts_len: u8,
    ) -> Result<()> {
        unlock_onyc::handler(ctx, redeem_accounts_len)
    }

    /// Swap the flow's ONyc amount into USDC via OnRe.
    pub fn swap_onyc_to_usdc<'info>(ctx: Context<'info, SwapOnycToUsdc<'info>>) -> Result<()> {
        swap_onyc_to_usdc::handler(ctx)
    }

    /// Send the flow's USDC amount back to the FOGO user recorded in
    /// the `Flow` PDA. Consumes the PDA.
    pub fn send_usdc_to_user<'info>(ctx: Context<'info, SendUsdcToUser<'info>>) -> Result<()> {
        send_usdc_to_user::handler(ctx)
    }

    // ── Admin ───────────────────────────────────────────────────────────

    /// Update admin-mutable relayer config. Pass `None` for fee args you
    /// don't want to change; the `fee_vault` account is optional and
    /// only validated/written when supplied. `new_authority`:
    /// `Some(pk)` proposes `pk` as the next authority (writes
    /// `pending_authority`; current `authority` unchanged); `None`
    /// leaves the proposal slot alone; `Some(Pubkey::default())`
    /// cancels any in-flight proposal. Authority-only.
    pub fn configure(
        ctx: Context<Configure>,
        deposit_fee_bps: Option<u16>,
        withdraw_fee_bps: Option<u16>,
        new_authority: Option<Pubkey>,
    ) -> Result<()> {
        configure::handler(ctx, deposit_fee_bps, withdraw_fee_bps, new_authority)
    }

    /// Two-step authority rotation, step two. Signer must equal
    /// `relayer_config.pending_authority`; on success that key
    /// atomically becomes `authority` and the pending slot clears.
    /// The current authority does NOT participate, by design — the
    /// two-step pattern lets two independent multisigs rotate
    /// without atomic cross-multisig coordination.
    pub fn accept_authority(ctx: Context<AcceptAuthority>) -> Result<()> {
        accept_authority::handler(ctx)
    }

    /// Authority-only escape hatch to extract stranded balances from the
    /// relayer-PDA-owned USDC/ONyc ATAs (pre-upgrade commingled fees,
    /// dust, accidental direct transfers, etc.). Operational flows always
    /// move exact `Flow.amount` so anything credited outside a tracked
    /// flow would otherwise be locked forever. See `sweep.rs` for the
    /// full trust-model rationale.
    pub fn sweep(ctx: Context<Sweep>, amount: u64) -> Result<()> {
        sweep::handler(ctx, amount)
    }
}
