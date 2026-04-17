use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::constants::{
    CONFIG_SEED, FLOW_INBOUND_SEED, FOGO_WORMHOLE_CHAIN_ID, NTT_PROGRAM_ID, NTT_TRANSFER_LOCK_IX,
    RELAYER_SEED,
};
use crate::cpi::invoke_relayer_signed;
use crate::error::RelayerError;
use crate::events::OnycLocked;
use crate::state::{Flow, FlowStatus, RelayerConfig};

/// Wormhole NTT `transfer_lock` args.
#[derive(AnchorSerialize, AnchorDeserialize)]
struct NttTransferArgs {
    amount: u64,
    recipient_chain: u16,
    recipient_address: [u8; 32],
    should_queue: bool,
}

/// Lock the flow's ONyc amount via Wormhole NTT, sending bONyc back to
/// the FOGO wallet recorded in the `Flow` PDA.
///
/// Permissionless. The recipient is bound to the flow PDA's `fogo_sender`.
/// Closing the PDA returns rent to the payer and blocks replays.
pub fn handler<'info>(ctx: Context<'info, LockOnyc<'info>>) -> Result<()> {
    let flow = &mut ctx.accounts.inflight_flow;
    require!(
        flow.status == FlowStatus::Swapped,
        RelayerError::FlowStatusMismatch
    );

    let amount = flow.amount;
    require!(amount > 0, RelayerError::InsufficientOnycBalance);

    let recipient = flow.fogo_sender;

    invoke_relayer_signed(
        NTT_PROGRAM_ID,
        &NTT_TRANSFER_LOCK_IX,
        &NttTransferArgs {
            amount,
            recipient_chain: FOGO_WORMHOLE_CHAIN_ID,
            recipient_address: recipient,
            should_queue: false,
        },
        ctx.remaining_accounts,
        &ctx.accounts.relayer_authority.to_account_info(),
        ctx.accounts.relayer_config.relayer_authority_bump,
    )?;

    emit!(OnycLocked {
        gateway_claim: ctx.accounts.gateway_claim.key(),
        fogo_sender: recipient,
        amount,
    });

    Ok(())
}

#[derive(Accounts)]
pub struct LockOnyc<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        seeds = [CONFIG_SEED],
        bump = relayer_config.bump,
        has_one = onyc_mint,
    )]
    pub relayer_config: Account<'info, RelayerConfig>,

    /// CHECK: PDA derived from RELAYER_SEED.
    #[account(seeds = [RELAYER_SEED], bump = relayer_config.relayer_authority_bump)]
    pub relayer_authority: UncheckedAccount<'info>,

    pub onyc_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = onyc_mint,
        associated_token::authority = relayer_authority,
        associated_token::token_program = token_program,
    )]
    pub onyc_ata: InterfaceAccount<'info, TokenAccount>,

    /// Same Gateway claim PDA used at `claim_usdc` time.
    /// CHECK: seed material only; validated transitively via the flow PDA.
    pub gateway_claim: UncheckedAccount<'info>,

    /// The one-shot receipt created by `claim_usdc`. `close = rent_destination`
    /// consumes the receipt so a second `lock_onyc` against the same flow
    /// is impossible.
    #[account(
        mut,
        close = rent_destination,
        seeds = [FLOW_INBOUND_SEED, gateway_claim.key().as_ref()],
        bump = inflight_flow.bump,
    )]
    pub inflight_flow: Account<'info, Flow>,

    /// The original payer who created this flow PDA. Receives the rent refund.
    /// CHECK: validated against the stored `payer` field in the flow PDA.
    #[account(mut, address = inflight_flow.payer)]
    pub rent_destination: UncheckedAccount<'info>,

    pub token_program: Interface<'info, TokenInterface>,
}
