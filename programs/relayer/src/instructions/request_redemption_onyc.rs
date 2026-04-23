//! Withdraw chain, step 2 of 3 (relayer-side step 1 of 2).
//!
//! Replaces the front half of the deleted `swap_onyc_to_usdc`. Takes the
//! withdrawal-leg fee, snapshots the relayer's USDC ATA balance, then CPIs
//! into OnRe's `create_redemption_request` to enqueue the ONyc-for-USDC
//! redemption. OnRe's `redemption_admin` fulfills it asynchronously, after
//! which `claim_redemption_usdc` advances the flow.
//!
//! The singleton `RedemptionTracker` PDA serves dual purpose: state binding
//! (which `RedemptionRequest` we're polling, what the pre-balance was) AND
//! in-flight mutex (Anchor `init` errors if a prior tracker still exists,
//! which is what makes the simple ATA-delta math in `claim_redemption_usdc`
//! correct without duplicating OnRe's pricing logic on-chain).

use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked,
};

use crate::constants::{
    CONFIG_SEED, FLOW_OUTBOUND_SEED, ONRE_CREATE_REDEMPTION_REQUEST_IX, ONRE_PROGRAM_ID,
    REDEMPTION_TRACKER_SEED, RELAYER_SEED,
};
use crate::cpi::invoke_relayer_signed;
use crate::error::RelayerError;
use crate::events::RedemptionRequested;
use crate::state::{Flow, FlowStatus, RedemptionTracker, RelayerConfig};

/// OnRe `create_redemption_request` args.
#[derive(AnchorSerialize)]
pub struct OnreCreateRedemptionRequestArgs {
    pub amount: u64,
}

/// Permissionless. Pre: `flow.status == Claimed`. Post:
/// `flow.status == RedemptionPending`, singleton tracker initialized,
/// ONyc transferred to OnRe's redemption vault.
pub fn handler<'info>(ctx: Context<'info, RequestRedemptionOnyc<'info>>) -> Result<()> {
    let flow_key = ctx.accounts.outflight_flow.key();
    let gross = ctx.accounts.outflight_flow.amount;

    require!(
        ctx.accounts.outflight_flow.status == FlowStatus::Claimed,
        RelayerError::FlowStatusMismatch
    );
    require!(gross > 0, RelayerError::ZeroAmountFlow);

    // Withdrawal fee taken pre-CPI on the ONyc input — same model as the
    // pre-redesign `swap_onyc_to_usdc`. Fee goes to fee_vault; `net` ONyc
    // is what OnRe receives.
    let (net, fee) = ctx.accounts.relayer_config.apply_withdraw_fee(gross)?;

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

    // Snapshot BEFORE the CPI. Singleton constraint guarantees no other
    // pending redemption is contributing to this balance, so the delta in
    // `claim_redemption_usdc` will be exclusively this flow's USDC.
    ctx.accounts.usdc_ata.reload()?;
    let usdc_pre = ctx.accounts.usdc_ata.amount;

    invoke_relayer_signed(
        ONRE_PROGRAM_ID,
        &ONRE_CREATE_REDEMPTION_REQUEST_IX,
        &OnreCreateRedemptionRequestArgs { amount: net },
        ctx.remaining_accounts,
        &ctx.accounts.relayer_authority.to_account_info(),
        ctx.accounts.relayer_config.relayer_authority_bump,
    )?;

    // Tracker init: PDA address comes from the cranker (must equal the
    // `RedemptionRequest` account OnRe just created — OnRe enforces seed
    // derivation server-side via its own `init` constraint, so if the
    // CPI succeeded then this key is guaranteed to be the real PDA).
    let tracker = &mut ctx.accounts.redemption_tracker;
    tracker.flow = flow_key;
    tracker.redemption_request = ctx.accounts.redemption_request.key();
    tracker.usdc_ata_pre_balance = usdc_pre;
    tracker.onyc_amount_in = net;
    tracker.payer = ctx.accounts.payer.key();
    tracker.bump = ctx.bumps.redemption_tracker;

    let flow = &mut ctx.accounts.outflight_flow;
    flow.amount = net;
    flow.status = FlowStatus::RedemptionPending;

    emit!(RedemptionRequested {
        flow: flow_key,
        redemption_request: tracker.redemption_request,
        gross_amount: gross,
        fee_amount: fee,
        net_amount: net,
        usdc_ata_pre_balance: usdc_pre,
    });

    Ok(())
}

#[derive(Accounts)]
pub struct RequestRedemptionOnyc<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        seeds = [CONFIG_SEED],
        bump = relayer_config.bump,
        has_one = usdc_mint,
        has_one = onyc_mint,
        has_one = fee_vault,
    )]
    pub relayer_config: Account<'info, RelayerConfig>,

    /// CHECK: PDA derived from RELAYER_SEED. Forced to sign in
    /// `invoke_relayer_signed` for the OnRe CPI.
    #[account(seeds = [RELAYER_SEED], bump = relayer_config.relayer_authority_bump)]
    pub relayer_authority: UncheckedAccount<'info>,

    pub usdc_mint: InterfaceAccount<'info, Mint>,
    pub onyc_mint: InterfaceAccount<'info, Mint>,

    /// Pre-balance snapshot source for the `claim_redemption_usdc` delta.
    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = relayer_authority,
        associated_token::token_program = token_program,
    )]
    pub usdc_ata: InterfaceAccount<'info, TokenAccount>,

    /// Source of the fee transfer; OnRe's CPI also pulls from here via the
    /// `redeemer_token_account` slot in `remaining_accounts`.
    #[account(
        mut,
        associated_token::mint = onyc_mint,
        associated_token::authority = relayer_authority,
        associated_token::token_program = token_program,
    )]
    pub onyc_ata: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        token::mint = onyc_mint,
        token::token_program = token_program,
    )]
    pub fee_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    /// CHECK: validated transitively via the flow PDA seeds.
    pub ntt_inbox_item: UncheckedAccount<'info>,

    /// Created by `unlock_onyc`; must be in `Claimed` status.
    #[account(
        mut,
        seeds = [FLOW_OUTBOUND_SEED, ntt_inbox_item.key().as_ref()],
        bump = outflight_flow.bump,
    )]
    pub outflight_flow: Account<'info, Flow>,

    /// Singleton init — fails if any prior redemption is still in flight.
    /// This is the on-chain mutex that makes the ATA-delta math safe.
    #[account(
        init,
        payer = payer,
        space = 8 + RedemptionTracker::INIT_SPACE,
        seeds = [REDEMPTION_TRACKER_SEED],
        bump,
    )]
    pub redemption_tracker: Account<'info, RedemptionTracker>,

    /// CHECK: the OnRe `RedemptionRequest` PDA. Cranker must also include
    /// this account at the slot OnRe's `create_redemption_request` expects
    /// inside `remaining_accounts` (index 2 in OnRe's account list). OnRe
    /// validates the seeds during `init`, so a wrong key fails the CPI.
    pub redemption_request: UncheckedAccount<'info>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}
