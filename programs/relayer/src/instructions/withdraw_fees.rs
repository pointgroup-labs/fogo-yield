use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked,
};

use crate::constants::{CONFIG_SEED, RELAYER_SEED};
use crate::error::RelayerError;
use crate::state::RelayerConfig;

/// Withdraw accumulated fees from the relayer authority's ATA to a
/// destination token account. Authority-only.
///
/// The authority is responsible for not withdrawing capital that belongs
/// to in-flight flows — only the fee surplus should be withdrawn.
pub fn handler(ctx: Context<WithdrawFees>, amount: u64) -> Result<()> {
    let bump = [ctx.accounts.relayer_config.relayer_authority_bump];
    let signer_seeds: &[&[u8]] = &[RELAYER_SEED, &bump];

    transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            TransferChecked {
                from: ctx.accounts.from_ata.to_account_info(),
                to: ctx.accounts.to_ata.to_account_info(),
                authority: ctx.accounts.relayer_authority.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
            },
            &[signer_seeds],
        ),
        amount,
        ctx.accounts.mint.decimals,
    )
}

#[derive(Accounts)]
pub struct WithdrawFees<'info> {
    pub authority: Signer<'info>,

    #[account(
        seeds = [CONFIG_SEED],
        bump = relayer_config.bump,
        has_one = authority @ RelayerError::UnauthorizedAuthority,
    )]
    pub relayer_config: Account<'info, RelayerConfig>,

    /// CHECK: PDA derived from RELAYER_SEED.
    #[account(seeds = [RELAYER_SEED], bump = relayer_config.relayer_authority_bump)]
    pub relayer_authority: UncheckedAccount<'info>,

    pub mint: InterfaceAccount<'info, Mint>,

    /// Source: relayer authority's ATA for the given mint.
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = relayer_authority,
        associated_token::token_program = token_program,
    )]
    pub from_ata: InterfaceAccount<'info, TokenAccount>,

    /// Destination: any token account for the same mint.
    #[account(
        mut,
        token::mint = mint,
        token::token_program = token_program,
    )]
    pub to_ata: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
}
