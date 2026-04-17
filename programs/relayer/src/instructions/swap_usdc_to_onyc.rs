use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::constants::{CONFIG_SEED, FLOW_INBOUND_SEED, ONRE_PROGRAM_ID, ONRE_TAKE_OFFER_IX, RELAYER_SEED};
use crate::cpi::invoke_relayer_signed;
use crate::error::RelayerError;
use crate::state::{Flow, FlowStatus, RelayerConfig};

/// Swap the flow's USDC amount into ONyc via OnRe.
///
/// Permissionless. Uses the amount recorded in the flow PDA (not the full
/// ATA balance), so concurrent flows are isolated.
///
/// `remaining_accounts` must contain OnRe's full account list for
/// `take_offer_permissionless`.
pub fn handler<'info>(ctx: Context<'info, SwapUsdcToOnyc<'info>>) -> Result<()> {
    let flow = &mut ctx.accounts.inflight_flow;
    require!(
        flow.status == FlowStatus::Claimed,
        RelayerError::FlowStatusMismatch
    );

    let amount = flow.amount;
    require!(amount > 0, RelayerError::InsufficientUsdcBalance);

    // Snapshot pre-swap ONyc balance
    let pre_onyc = ctx.accounts.onyc_ata.amount;

    invoke_relayer_signed(
        ONRE_PROGRAM_ID,
        &ONRE_TAKE_OFFER_IX,
        &amount,
        ctx.remaining_accounts,
        &ctx.accounts.relayer_authority.to_account_info(),
        ctx.accounts.relayer_config.relayer_authority_bump,
    )?;

    // Delta = ONyc received from this swap
    ctx.accounts.onyc_ata.reload()?;
    flow.amount = ctx.accounts.onyc_ata.amount
        .checked_sub(pre_onyc)
        .ok_or(RelayerError::BalanceUnderflow)?;
    require!(flow.amount > 0, RelayerError::ZeroAmountFlow);
    flow.status = FlowStatus::Swapped;

    Ok(())
}

#[derive(Accounts)]
pub struct SwapUsdcToOnyc<'info> {
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

    /// Gateway claim PDA — seed material for the flow PDA.
    /// CHECK: validated transitively via the flow PDA seeds.
    pub gateway_claim: UncheckedAccount<'info>,

    /// The flow PDA created by `claim_usdc`. Must be in `Claimed` status.
    #[account(
        mut,
        seeds = [FLOW_INBOUND_SEED, gateway_claim.key().as_ref()],
        bump = inflight_flow.bump,
    )]
    pub inflight_flow: Account<'info, Flow>,

    pub token_program: Interface<'info, TokenInterface>,
}
