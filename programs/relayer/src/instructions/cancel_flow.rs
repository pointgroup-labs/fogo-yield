use anchor_lang::prelude::*;

use crate::constants::CONFIG_SEED;
use crate::error::RelayerError;
use crate::state::{Flow, RelayerConfig};

/// Authority-only escape hatch to close a stuck `Flow` PDA and return its
/// rent to the original payer.
///
/// This is needed because a flow can get stuck if an intermediate CPI
/// (e.g. OnRe swap) permanently reverts — without this instruction the
/// rent would be locked forever.
pub fn handler(_ctx: Context<CancelFlow>) -> Result<()> {
    // Account constraints handle everything: authority check, close, rent return.
    // Nothing else to do.
    Ok(())
}

#[derive(Accounts)]
pub struct CancelFlow<'info> {
    /// Must be the config authority.
    pub authority: Signer<'info>,

    #[account(
        seeds = [CONFIG_SEED],
        bump = relayer_config.bump,
        has_one = authority @ RelayerError::UnauthorizedAuthority,
    )]
    pub relayer_config: Account<'info, RelayerConfig>,

    /// The stuck flow PDA to close. Can be either inbound or outbound —
    /// the caller must pass the correct PDA address (Anchor validates the
    /// account discriminator).
    #[account(
        mut,
        close = rent_destination,
    )]
    pub flow: Account<'info, Flow>,

    /// The original payer who created this flow PDA. Receives the rent refund.
    /// CHECK: validated against the stored `payer` field in the flow PDA.
    #[account(mut, address = flow.payer)]
    pub rent_destination: UncheckedAccount<'info>,
}
