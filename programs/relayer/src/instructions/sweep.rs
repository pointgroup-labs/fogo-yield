use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked,
};

use crate::constants::{CONFIG_SEED, RELAYER_SEED};
use crate::error::RelayerError;
use crate::state::RelayerConfig;

/// Authority-only escape hatch to extract tokens stranded in the
/// relayer's PDA-owned ATAs.
///
/// Why this exists: every operational instruction transfers exactly the
/// `Flow.amount` recorded by the inbound bridge step — never the full
/// ATA balance. Anything credited to the ATA *outside* of a tracked flow
/// (pre-upgrade commingled fees, OnRe rounding/dust, accidental direct
/// transfers, donations, slippage gains, refunds, future bug recoveries)
/// is therefore unreachable by any of the user-facing flows. Without
/// this instruction, those balances would be permanently locked behind
/// the PDA signature.
///
/// Trust assumption: the authority is already trusted via `configure`
/// to retarget the fee vault. Granting it the same signature power to
/// transfer arbitrary amounts out of the operating ATAs is no expansion
/// of trust — a malicious authority that wanted to grief users could
/// already do so by setting fees to 100%. The only new capability is
/// extraction of *non-flow-tracked* balances, which is exactly the
/// stranded-funds class we want to recover.
///
/// Mint guard: the supplied `mint` MUST be either `usdc_mint` or
/// `onyc_mint` from config. This is belt-and-suspenders — the `from`
/// account derivation already pins the relayer-owned ATA for that mint,
/// so an attacker-controlled mint would fail the ATA constraint anyway.
pub fn handler(ctx: Context<Sweep>, amount: u64) -> Result<()> {
    let config = &ctx.accounts.relayer_config;
    let mint_key = ctx.accounts.mint.key();
    require!(
        mint_key == config.usdc_mint || mint_key == config.onyc_mint,
        RelayerError::UnauthorizedAuthority
    );

    let auth_bump = [config.relayer_authority_bump];
    let auth_seeds: &[&[u8]] = &[RELAYER_SEED, &auth_bump];

    transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            TransferChecked {
                from: ctx.accounts.from.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.to.to_account_info(),
                authority: ctx.accounts.relayer_authority.to_account_info(),
            },
            &[auth_seeds],
        ),
        amount,
        ctx.accounts.mint.decimals,
    )?;

    msg!(
        "Sweep: {} of mint {} from {} to {}.",
        amount,
        mint_key,
        ctx.accounts.from.key(),
        ctx.accounts.to.key(),
    );

    Ok(())
}

#[derive(Accounts)]
pub struct Sweep<'info> {
    pub authority: Signer<'info>,

    #[account(
        seeds = [CONFIG_SEED],
        bump = relayer_config.bump,
        has_one = authority @ RelayerError::UnauthorizedAuthority,
    )]
    pub relayer_config: Account<'info, RelayerConfig>,

    /// CHECK: PDA derived from RELAYER_SEED; signer for the transfer.
    #[account(
        seeds = [RELAYER_SEED],
        bump = relayer_config.relayer_authority_bump,
    )]
    pub relayer_authority: UncheckedAccount<'info>,

    /// The mint of the tokens being swept. Constrained at runtime to be
    /// either `usdc_mint` or `onyc_mint` from `relayer_config`.
    pub mint: InterfaceAccount<'info, Mint>,

    /// Source — the relayer-authority-owned ATA for `mint`. The
    /// associated-token derivation pins this implicitly.
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = relayer_authority,
        associated_token::token_program = token_program,
    )]
    pub from: InterfaceAccount<'info, TokenAccount>,

    /// Destination — any token account holding `mint`. Authority's
    /// discretion (typically the configured `fee_vault` for ONyc, or a
    /// treasury account for USDC).
    #[account(
        mut,
        token::mint = mint,
        token::token_program = token_program,
    )]
    pub to: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
}
