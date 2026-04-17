use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{Mint, TokenAccount, TokenInterface},
};

use crate::constants::{CONFIG_SEED, RELAYER_SEED};
use crate::state::RelayerConfig;

/// Initialize the relayer program.
///
/// Creates the `RelayerConfig` PDA, and the USDC + ONyc token accounts
/// owned by the relayer authority PDA. This instruction is called once
/// at deployment time.
pub fn handler(ctx: Context<Initialize>, deposit_fee_bps: u16, withdraw_fee_bps: u16) -> Result<()> {
    let config = &mut ctx.accounts.relayer_config;
    config.authority = ctx.accounts.authority.key();
    config.usdc_mint = ctx.accounts.usdc_mint.key();
    config.onyc_mint = ctx.accounts.onyc_mint.key();
    config.bump = ctx.bumps.relayer_config;
    config.relayer_authority_bump = ctx.bumps.relayer_authority;
    config.deposit_fee_bps = deposit_fee_bps;
    config.withdraw_fee_bps = withdraw_fee_bps;
    config.validate()?;

    msg!(
        "Relayer initialized. USDC ATA: {}. ONyc ATA: {}.",
        ctx.accounts.usdc_ata.key(),
        ctx.accounts.onyc_ata.key(),
    );

    Ok(())
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    /// Deployer / authority — pays for account creation and becomes the
    /// admin key.
    #[account(mut)]
    pub authority: Signer<'info>,

    /// Relayer config PDA — stores mint references.
    #[account(
        init,
        payer = authority,
        space = 8 + RelayerConfig::INIT_SPACE,
        seeds = [CONFIG_SEED],
        bump,
    )]
    pub relayer_config: Account<'info, RelayerConfig>,

    /// Relayer authority PDA — owns the token accounts.
    /// CHECK: PDA derived from RELAYER_SEED; no data, just used as ATA owner.
    #[account(
        seeds = [RELAYER_SEED],
        bump,
    )]
    pub relayer_authority: UncheckedAccount<'info>,

    /// USDC token mint.
    pub usdc_mint: InterfaceAccount<'info, Mint>,

    /// ONyc token mint.
    pub onyc_mint: InterfaceAccount<'info, Mint>,

    /// USDC associated token account owned by the relayer authority PDA.
    #[account(
        init,
        payer = authority,
        associated_token::mint = usdc_mint,
        associated_token::authority = relayer_authority,
        associated_token::token_program = token_program,
    )]
    pub usdc_ata: InterfaceAccount<'info, TokenAccount>,

    /// ONyc associated token account owned by the relayer authority PDA.
    #[account(
        init,
        payer = authority,
        associated_token::mint = onyc_mint,
        associated_token::authority = relayer_authority,
        associated_token::token_program = token_program,
    )]
    pub onyc_ata: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}
