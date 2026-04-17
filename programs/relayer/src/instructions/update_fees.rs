use anchor_lang::prelude::*;

use crate::constants::CONFIG_SEED;
use crate::error::RelayerError;
use crate::state::RelayerConfig;

/// Update the fee basis points charged on deposit and withdrawal flows.
/// Authority-only.
pub fn handler(ctx: Context<UpdateFees>, deposit_fee_bps: u16, withdraw_fee_bps: u16) -> Result<()> {
    let config = &mut ctx.accounts.relayer_config;
    config.deposit_fee_bps = deposit_fee_bps;
    config.withdraw_fee_bps = withdraw_fee_bps;
    config.validate()?;
    Ok(())
}

#[derive(Accounts)]
pub struct UpdateFees<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = relayer_config.bump,
        has_one = authority @ RelayerError::UnauthorizedAuthority,
    )]
    pub relayer_config: Account<'info, RelayerConfig>,
}
