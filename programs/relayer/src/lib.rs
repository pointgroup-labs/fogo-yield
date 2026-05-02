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

declare_id!("onrenRKgX54qtWeK3cuaTBE71xx7dWMXn82ubH61vAp");

/// Stateless cross-chain relayer between FOGO and Solana.
///
/// All operational instructions are permissionless. Safety comes from the
/// Flow PDA design: each inbound Wormhole message carries the originating
/// FOGO user's wallet in its payload. `claim_usdc` / `unlock_onyc` persist
/// that wallet in a one-shot `Flow` PDA keyed by the bridge's per-VAA claim
/// account; `lock_onyc` / `send_usdc_to_user` consume the PDA to choose the
/// outbound recipient. A stolen operator key cannot redirect outbound
/// transfers — the claim PDA is CPI-created by the bridge program and
/// unforgeable.
#[program]
pub mod relayer {
    use super::*;

    /// One-time setup: create config PDA + relayer-authority-owned ATAs.
    pub fn initialize(
        ctx: Context<Initialize>,
        deposit_fee_bps: u16,
        withdraw_fee_bps: u16,
    ) -> Result<()> {
        initialize::handler(ctx, deposit_fee_bps, withdraw_fee_bps)
    }

    /// Claim bridged USDC and create an inflight `Flow` receipt binding the
    /// eventual bONyc return to the originator's FOGO wallet.
    pub fn claim_usdc<'info>(ctx: Context<'info, ClaimUsdc<'info>>) -> Result<()> {
        claim_usdc::handler(ctx)
    }

    pub fn swap_usdc_to_onyc<'info>(ctx: Context<'info, SwapUsdcToOnyc<'info>>) -> Result<()> {
        swap_usdc_to_onyc::handler(ctx)
    }

    /// Lock ONyc via NTT, sending bONyc to `flow.fogo_sender`. Closes the PDA.
    pub fn lock_onyc<'info>(ctx: Context<'info, LockOnyc<'info>>) -> Result<()> {
        lock_onyc::handler(ctx)
    }

    /// Release ONyc from NTT custody and record a `Flow` receipt for the
    /// withdrawal initiator.
    pub fn unlock_onyc<'info>(
        ctx: Context<'info, UnlockOnyc<'info>>,
        redeem_accounts_len: u8,
    ) -> Result<()> {
        unlock_onyc::handler(ctx, redeem_accounts_len)
    }

    /// Forward flow's ONyc to OnRe via `create_redemption_request` and
    /// init the singleton tracker. Fee taken pre-CPI.
    pub fn request_redemption_onyc<'info>(
        ctx: Context<'info, RequestRedemptionOnyc<'info>>,
    ) -> Result<()> {
        request_redemption_onyc::handler(ctx)
    }

    pub fn claim_redemption_usdc(ctx: Context<ClaimRedemptionUsdc>) -> Result<()> {
        claim_redemption_usdc::handler(ctx)
    }

    /// Authority-only escape hatch. Aborts an in-flight OnRe redemption
    /// (returns ONyc to `onyc_ata`, rolls flow back to `Claimed`, frees
    /// the singleton). Authority-gated to prevent the
    /// request→cancel→request fee-griefing loop a permissionless cancel
    /// would enable.
    pub fn cancel_redemption_onyc<'info>(
        ctx: Context<'info, CancelRedemptionOnyc<'info>>,
    ) -> Result<()> {
        cancel_redemption_onyc::handler(ctx)
    }

    pub fn send_usdc_to_user<'info>(ctx: Context<'info, SendUsdcToUser<'info>>) -> Result<()> {
        send_usdc_to_user::handler(ctx)
    }

    /// Authority-only. `None` args leave the corresponding field unchanged.
    /// Fee decreases apply instantly; increases stage into `pending_fee`
    /// for `FEE_TIMELOCK_SLOTS` (~2 days), auto-promoted on the next
    /// `configure` call after the window elapses.
    pub fn configure(
        ctx: Context<Configure>,
        deposit_fee_bps: Option<u16>,
        withdraw_fee_bps: Option<u16>,
        new_authority: Option<Pubkey>,
    ) -> Result<()> {
        configure::handler(ctx, deposit_fee_bps, withdraw_fee_bps, new_authority)
    }

    /// Two-step rotation, step two. Signer must equal
    /// `relayer_config.pending_authority`. Current authority does NOT
    /// participate — by design, so two independent multisigs can rotate
    /// without atomic cross-multisig coordination.
    pub fn accept_authority(ctx: Context<AcceptAuthority>) -> Result<()> {
        accept_authority::handler(ctx)
    }
}
