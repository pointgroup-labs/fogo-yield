use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::constants::{
    CONFIG_SEED, FLOW_OUTBOUND_SEED, FOGO_WORMHOLE_CHAIN_ID, GATEWAY_PROGRAM_ID,
    GATEWAY_TRANSFER_OUT_IX, RELAYER_SEED,
};
use crate::cpi::invoke_relayer_signed;
use crate::error::RelayerError;
use crate::events::UsdcSentToUser;
use crate::state::{Flow, FlowStatus, RelayerConfig};

/// Portal Token Bridge `TransferWrappedWithPayload` instruction data.
#[derive(AnchorSerialize, AnchorDeserialize)]
struct GatewayTransferArgs {
    nonce: u32,
    amount: u64,
    target_address: [u8; 32],
    target_chain: u16,
    payload: Vec<u8>,
}

/// Send the flow's USDC amount back to the FOGO user recorded in the
/// `Flow` PDA.
///
/// Permissionless. The recipient is bound to the flow PDA's `fogo_sender`.
/// Closing the PDA returns rent to the payer and blocks replays.
pub fn handler<'info>(ctx: Context<'info, SendUsdcToUser<'info>>) -> Result<()> {
    let flow = &mut ctx.accounts.outflight_flow;
    require!(
        flow.status == FlowStatus::Swapped,
        RelayerError::FlowStatusMismatch
    );

    let amount = flow.amount;
    require!(amount > 0, RelayerError::ZeroAmountFlow);

    let recipient = flow.fogo_sender;

    invoke_relayer_signed(
        GATEWAY_PROGRAM_ID,
        &GATEWAY_TRANSFER_OUT_IX,
        &GatewayTransferArgs {
            nonce: 0,
            amount,
            target_address: recipient,
            target_chain: FOGO_WORMHOLE_CHAIN_ID,
            payload: Vec::new(),
        },
        ctx.remaining_accounts,
        &ctx.accounts.relayer_authority.to_account_info(),
        ctx.accounts.relayer_config.relayer_authority_bump,
    )?;

    emit!(UsdcSentToUser {
        flow: ctx.accounts.outflight_flow.key(),
        ntt_inbox_item: ctx.accounts.ntt_inbox_item.key(),
        fogo_sender: recipient,
        amount,
    });

    Ok(())
}

#[derive(Accounts)]
pub struct SendUsdcToUser<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        seeds = [CONFIG_SEED],
        bump = relayer_config.bump,
        has_one = usdc_mint,
    )]
    pub relayer_config: Account<'info, RelayerConfig>,

    /// CHECK: PDA derived from RELAYER_SEED.
    #[account(seeds = [RELAYER_SEED], bump = relayer_config.relayer_authority_bump)]
    pub relayer_authority: UncheckedAccount<'info>,

    pub usdc_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = relayer_authority,
        associated_token::token_program = token_program,
    )]
    pub usdc_ata: InterfaceAccount<'info, TokenAccount>,

    /// Same NTT inbox-item PDA used at `unlock_onyc` time.
    /// CHECK: seed material only; validated transitively via the flow PDA.
    pub ntt_inbox_item: UncheckedAccount<'info>,

    /// The one-shot receipt created by `unlock_onyc`. Closing it on
    /// success returns rent to the original payer and blocks replays.
    #[account(
        mut,
        close = rent_destination,
        seeds = [FLOW_OUTBOUND_SEED, ntt_inbox_item.key().as_ref()],
        bump = outflight_flow.bump,
    )]
    pub outflight_flow: Account<'info, Flow>,

    /// The original payer who created this flow PDA. Receives the rent refund.
    /// CHECK: validated against the stored `payer` field in the flow PDA.
    #[account(mut, address = outflight_flow.payer)]
    pub rent_destination: UncheckedAccount<'info>,

    pub token_program: Interface<'info, TokenInterface>,
}
