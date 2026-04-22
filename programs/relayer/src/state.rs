use anchor_lang::prelude::*;

use crate::constants::CONFIG_SEED;
use crate::error::RelayerError;

/// Relayer configuration — the only long-lived state in this program.
///
/// The `authority` is a cold/admin key used only for governance (e.g.
/// updating config). All operational instructions are permissionless —
/// anyone can crank them because recipients are VAA-bound, amounts are
/// flow-bound, and CPI targets are compile-time constants.
#[account]
#[derive(InitSpace)]
pub struct RelayerConfig {
    /// Admin key for governance operations.
    pub authority: Pubkey,

    /// Pending admin key, set by `configure(new_authority=Some(pk))`.
    /// Becomes `authority` only after a separate `accept_authority`
    /// transaction signed by this key. `None` when no rotation is
    /// in flight. Two-step design accommodates multisig→multisig
    /// rotations where the two parties cannot atomically co-sign
    /// (e.g. two independent Squads vaults).
    pub pending_authority: Option<Pubkey>,

    /// USDC token mint on Solana.
    pub usdc_mint: Pubkey,

    /// ONyc token mint on Solana.
    pub onyc_mint: Pubkey,

    /// Single fee vault — PDA-addressed token account holding ALL
    /// accumulated fees (both deposit-leg and withdrawal-leg, denominated
    /// in ONyc).
    pub fee_vault: Pubkey,

    /// Bump seed for the config PDA.
    pub bump: u8,

    /// Bump seed for the relayer authority PDA (needed for CPI invoke_signed).
    pub relayer_authority_bump: u8,

    /// Fee in basis points (1 bps = 0.01%) charged on each deposit flow (USDC → ONyc).
    pub deposit_fee_bps: u16,

    /// Fee in basis points (1 bps = 0.01%) charged on each withdrawal flow (ONyc → USDC).
    pub withdraw_fee_bps: u16,
}

impl RelayerConfig {
    pub const SEEDS: &'static [u8] = CONFIG_SEED;

    /// Validate that fee basis points do not exceed 100% (10 000 bps).
    pub fn validate(&self) -> Result<()> {
        require!(self.deposit_fee_bps <= 10_000, RelayerError::FeeBpsTooHigh);
        require!(self.withdraw_fee_bps <= 10_000, RelayerError::FeeBpsTooHigh);
        Ok(())
    }

    /// Subtract the deposit-leg fee (bps) from `gross`. Returns
    /// `(net, fee)`. Fails with `FeeOverflow` on arithmetic overflow and
    /// `ZeroAmountFlow` if the net is zero.
    pub fn apply_deposit_fee(&self, gross: u64) -> Result<(u64, u64)> {
        apply_fee_bps(gross, self.deposit_fee_bps)
    }

    /// Subtract the withdrawal-leg fee (bps) from `gross`. See
    /// `apply_deposit_fee` for the return tuple and error semantics.
    pub fn apply_withdraw_fee(&self, gross: u64) -> Result<(u64, u64)> {
        apply_fee_bps(gross, self.withdraw_fee_bps)
    }
}

/// `fee = floor(gross * bps / 10_000); net = gross - fee`. Returns
/// `(net, fee)`.
fn apply_fee_bps(gross: u64, bps: u16) -> Result<(u64, u64)> {
    let fee = (gross as u128)
        .checked_mul(bps as u128)
        .ok_or(RelayerError::FeeOverflow)?
        / 10_000;
    let fee_u64 = fee as u64;
    let net = gross
        .checked_sub(fee_u64)
        .ok_or(RelayerError::FeeOverflow)?;
    require!(net > 0, RelayerError::ZeroAmountFlow);
    Ok((net, fee_u64))
}

/// Status of a flow through the relayer pipeline.
#[derive(InitSpace, AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum FlowStatus {
    /// Inbound bridge complete, awaiting swap.
    Claimed,
    /// Swap complete, awaiting outbound bridge.
    Swapped,
}

/// One-shot receipt binding an inbound bridge message to a FOGO user wallet.
///
/// Used by both deposit and withdrawal legs — direction is implicit in the
/// PDA seed prefix (`FLOW_INBOUND_SEED` vs `FLOW_OUTBOUND_SEED`).
///
/// Created by `claim_usdc` or `unlock_onyc` when the relayer processes an
/// inbound Wormhole message. The `fogo_sender` field records the originating
/// FOGO user's wallet (parsed from the VAA payload). Consumed by `lock_onyc`
/// or `send_usdc_to_user`, which read `fogo_sender` as the outbound
/// recipient.
///
/// The `status` field tracks which pipeline step has completed, enabling
/// resumability if a multi-step flow stalls. The `amount` field isolates
/// each flow's capital so concurrent flows don't mix funds.
///
/// PDA seeds: `[FLOW_*_SEED, bridge_claim_pda.key()]`, where
/// `bridge_claim_pda` is the per-VAA claim account created by Wormhole
/// Gateway or NTT. This delegates uniqueness and replay protection to the
/// bridge program itself — no hashing needed.
#[account]
#[derive(InitSpace)]
pub struct Flow {
    /// FOGO address of the user who originated the bridge message.
    /// Becomes the outbound Wormhole recipient on the return leg.
    pub fogo_sender: [u8; 32],

    /// Current status in the pipeline.
    pub status: FlowStatus,

    /// Token amount for the current/next step.
    pub amount: u64,

    /// The payer who created this flow PDA (receives rent on close).
    pub payer: Pubkey,

    /// PDA bump.
    pub bump: u8,
}
