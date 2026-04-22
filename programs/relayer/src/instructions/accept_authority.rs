use anchor_lang::prelude::*;

use crate::constants::CONFIG_SEED;
use crate::error::RelayerError;
use crate::state::RelayerConfig;

/// Step two of the two-step authority rotation. The pending authority
/// (proposed in a prior `configure` call) signs this instruction to
/// atomically:
///
///   - Move `pending_authority` into `authority`
///   - Clear `pending_authority` to `None`
///
/// The signer must equal the proposed key; otherwise
/// `PendingAuthorityMismatch` fires. If no rotation is in flight,
/// `NoPendingAuthority` fires. The current authority does not
/// participate in this transaction at all — by design, so the two
/// parties (typically two independent multisigs) can complete a
/// rotation without atomic cross-multisig coordination.
///
/// Until the new authority signs `accept_authority`, the current
/// authority retains full control: a typo or wrong-key proposal is
/// harmless and can be overwritten or cancelled via `configure`.
pub fn handler(ctx: Context<AcceptAuthority>) -> Result<()> {
    let config = &mut ctx.accounts.relayer_config;

    let pending = config
        .pending_authority
        .ok_or(RelayerError::NoPendingAuthority)?;

    require_keys_eq!(
        ctx.accounts.pending_authority.key(),
        pending,
        RelayerError::PendingAuthorityMismatch
    );

    config.authority = pending;
    config.pending_authority = None;

    msg!(
        "Relayer authority rotated. New authority: {}.",
        config.authority,
    );

    Ok(())
}

#[derive(Accounts)]
pub struct AcceptAuthority<'info> {
    /// The proposed new authority. Must equal
    /// `relayer_config.pending_authority`.
    pub pending_authority: Signer<'info>,

    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = relayer_config.bump,
    )]
    pub relayer_config: Account<'info, RelayerConfig>,
}
