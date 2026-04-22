use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::constants::{CONFIG_SEED, FLOW_OUTBOUND_SEED, RELAYER_SEED};
use crate::onre::execute_onre_swap;
use crate::state::{Flow, RelayerConfig};

/// Swap the flow's ONyc amount into USDC via OnRe.
///
/// Permissionless. Uses the amount recorded in the flow PDA.
///
/// `remaining_accounts` must contain OnRe's full account list for
/// `take_offer_permissionless` with the reverse-direction offer PDA.
pub fn handler<'info>(ctx: Context<'info, SwapOnycToUsdc<'info>>) -> Result<()> {
    execute_onre_swap(
        &mut ctx.accounts.outflight_flow,
        &mut ctx.accounts.usdc_ata,
        &ctx.accounts.relayer_authority.to_account_info(),
        &ctx.accounts.relayer_config,
        ctx.remaining_accounts,
    )
}

#[derive(Accounts)]
pub struct SwapOnycToUsdc<'info> {
    #[account(
        seeds = [CONFIG_SEED],
        bump = relayer_config.bump,
        has_one = usdc_mint,
        has_one = onyc_mint,
    )]
    pub relayer_config: Account<'info, RelayerConfig>,

    /// CHECK: PDA derived from RELAYER_SEED.
    #[account(seeds = [RELAYER_SEED], bump = relayer_config.relayer_authority_bump)]
    pub relayer_authority: UncheckedAccount<'info>,

    pub usdc_mint: InterfaceAccount<'info, Mint>,
    pub onyc_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = relayer_authority,
        associated_token::token_program = token_program,
    )]
    pub usdc_ata: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = onyc_mint,
        associated_token::authority = relayer_authority,
        associated_token::token_program = token_program,
    )]
    pub onyc_ata: InterfaceAccount<'info, TokenAccount>,

    /// NTT inbox-item PDA — seed material for the flow PDA.
    /// CHECK: validated transitively via the flow PDA seeds.
    pub ntt_inbox_item: UncheckedAccount<'info>,

    /// The flow PDA created by `unlock_onyc`. Must be in `Claimed` status.
    #[account(
        mut,
        seeds = [FLOW_OUTBOUND_SEED, ntt_inbox_item.key().as_ref()],
        bump = outflight_flow.bump,
    )]
    pub outflight_flow: Account<'info, Flow>,

    pub token_program: Interface<'info, TokenInterface>,
}
