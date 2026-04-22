use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked,
};

use crate::constants::{CONFIG_SEED, FLOW_INBOUND_SEED, RELAYER_SEED};
use crate::events::OnycSwapped;
use crate::onre::execute_onre_swap;
use crate::state::{Flow, RelayerConfig};

/// Swap the flow's USDC amount into ONyc via OnRe, then take the
/// configured deposit-leg fee from the ONyc output and route it to the
/// shared `onyc_fee_vault`.
///
/// Permissionless. Uses the amount recorded in the flow PDA (not the full
/// ATA balance), so concurrent flows are isolated.
///
/// `remaining_accounts` must contain OnRe's full account list for
/// `take_offer_permissionless`.
pub fn handler<'info>(ctx: Context<'info, SwapUsdcToOnyc<'info>>) -> Result<()> {
    let flow_key = ctx.accounts.inflight_flow.key();

    // 1. Swap USDC → ONyc. After this call, `flow.amount` = ONyc received,
    //    `flow.status` = Swapped (post-conditions enforced by execute_onre_swap).
    execute_onre_swap(
        &mut ctx.accounts.inflight_flow,
        &mut ctx.accounts.onyc_ata,
        &ctx.accounts.relayer_authority.to_account_info(),
        &ctx.accounts.relayer_config,
        ctx.remaining_accounts,
    )?;

    // 2. Apply deposit fee POST-swap from the ONyc output.
    let gross = ctx.accounts.inflight_flow.amount;
    let (net, fee) = ctx.accounts.relayer_config.apply_deposit_fee(gross)?;

    // 3. Physically segregate the fee into the ONyc fee vault. After this,
    //    `onyc_ata` holds only in-flight user funds.
    if fee > 0 {
        let auth_bump = [ctx.accounts.relayer_config.relayer_authority_bump];
        let auth_seeds: &[&[u8]] = &[RELAYER_SEED, &auth_bump];
        transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                TransferChecked {
                    from: ctx.accounts.onyc_ata.to_account_info(),
                    mint: ctx.accounts.onyc_mint.to_account_info(),
                    to: ctx.accounts.fee_vault.to_account_info(),
                    authority: ctx.accounts.relayer_authority.to_account_info(),
                },
                &[auth_seeds],
            ),
            fee,
            ctx.accounts.onyc_mint.decimals,
        )?;
    }

    ctx.accounts.inflight_flow.amount = net;

    emit!(OnycSwapped {
        flow: flow_key,
        gross_amount: gross,
        fee_amount: fee,
        net_amount: net,
    });

    Ok(())
}

#[derive(Accounts)]
pub struct SwapUsdcToOnyc<'info> {
    #[account(
        seeds = [CONFIG_SEED],
        bump = relayer_config.bump,
        has_one = usdc_mint,
        has_one = onyc_mint,
        has_one = fee_vault,
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

    /// Single fee vault — receives the post-swap deposit fee. Pinned by
    /// `has_one = fee_vault` on `relayer_config`. Can be any pre-existing
    /// ONyc token account (configured at `initialize` time); does not need
    /// to be relayer-owned.
    #[account(
        mut,
        token::mint = onyc_mint,
        token::token_program = token_program,
    )]
    pub fee_vault: Box<InterfaceAccount<'info, TokenAccount>>,

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
