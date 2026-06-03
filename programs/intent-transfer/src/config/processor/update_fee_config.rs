use crate::config::access_control::*;
use crate::config::state::fee_config::{FeeConfig, FEE_CONFIG_SEED};
use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::token::Mint;

/// Upgrade-authority-gated edit of an existing per-mint `FeeConfig`. The live
/// PDA predates `fee_recipient`, so a typed `Account<FeeConfig>` would fail
/// `try_from` (borsh can't read the missing 32 trailing bytes) before realloc
/// ever runs. We take it `UncheckedAccount`, grow it to the current layout, and
/// write all fields manually. Leading u64 fees are supplied by the caller.
#[derive(Accounts)]
pub struct UpdateFeeConfig<'info> {
    pub upgrade_authority: UpgradeAuthority<'info>,

    pub mint: Account<'info, Mint>,

    /// CHECK: PDA validated by seeds; migrated manually (see struct doc).
    #[account(mut, seeds = [FEE_CONFIG_SEED, mint.key().as_ref()], bump)]
    pub fee_config: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

impl<'info> UpdateFeeConfig<'info> {
    pub fn process(&mut self, fee_config: FeeConfig) -> Result<()> {
        let info = self.fee_config.to_account_info();
        let new_len = FeeConfig::DISCRIMINATOR.len() + FeeConfig::INIT_SPACE;

        let needed = Rent::get()?.minimum_balance(new_len);
        let current = info.lamports();
        if needed > current {
            system_program::transfer(
                CpiContext::new(
                    self.system_program.to_account_info(),
                    system_program::Transfer {
                        from: self.upgrade_authority.signer.to_account_info(),
                        to: info.clone(),
                    },
                ),
                needed - current,
            )?;
        }
        info.realloc(new_len, false)?;

        let disc_len = FeeConfig::DISCRIMINATOR.len();
        let mut data = info.try_borrow_mut_data()?;
        data[..disc_len].copy_from_slice(FeeConfig::DISCRIMINATOR);
        let mut body = &mut data[disc_len..];
        fee_config.serialize(&mut body)?;
        Ok(())
    }
}
