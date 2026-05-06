use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::invoke_signed;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::constants::{
    CONFIG_SEED, FLOW_OUTBOUND_SEED, FOGO_WORMHOLE_CHAIN_ID, NTT_TRANSFER_LOCK_IX,
    NTT_USDC_PROGRAM_ID, REDEMPTION_TRACKER_SEED, RELAYER_SEED, SPL_TOKEN_APPROVE_IX_TAG,
};
use crate::cpi::invoke_relayer_signed;
use crate::error::RelayerError;
use crate::events::UsdcSentToUser;
use crate::ntt::{derive_session_authority, NttTransferArgs};
use crate::state::{Flow, FlowStatus, RelayerConfig};

/// Lock the flow's USDC via Wormhole NTT, sending USDC.s back to
/// `flow.fogo_sender`. Permissionless; closing the PDA returns rent and
/// blocks replay.
pub fn handler<'info>(ctx: Context<'info, SendUsdcToUser<'info>>) -> Result<()> {
    let flow = &mut ctx.accounts.outflight_flow;
    require!(
        flow.status == FlowStatus::Swapped,
        RelayerError::FlowStatusMismatch
    );

    let amount = flow.amount;
    require!(amount > 0, RelayerError::ZeroAmountFlow);

    let recipient = flow.fogo_sender;

    let transfer_args = NttTransferArgs {
        amount,
        recipient_chain: FOGO_WORMHOLE_CHAIN_ID,
        recipient_address: recipient,
        should_queue: false,
    };

    // NTT binds session-authority to a hash of the transfer args.
    let (session_authority, _) = derive_session_authority(
        &NTT_USDC_PROGRAM_ID,
        &ctx.accounts.relayer_authority.key(),
        &transfer_args,
    );

    let bump = [ctx.accounts.relayer_config.relayer_authority_bump];
    let signer_seeds: &[&[u8]] = &[RELAYER_SEED, &bump];

    let approve_ix = instruction::Instruction {
        program_id: ctx.accounts.token_program.key(),
        accounts: vec![
            AccountMeta::new(ctx.accounts.usdc_ata.key(), false),
            AccountMeta::new_readonly(session_authority, false),
            AccountMeta::new_readonly(ctx.accounts.relayer_authority.key(), true),
        ],
        data: {
            let mut d = Vec::with_capacity(9);
            d.push(SPL_TOKEN_APPROVE_IX_TAG);
            d.extend_from_slice(&amount.to_le_bytes());
            d
        },
    };

    let session_auth_info = ctx
        .remaining_accounts
        .iter()
        .find(|a| a.key() == session_authority)
        .ok_or(RelayerError::MissingSessionAuthority)?;

    invoke_signed(
        &approve_ix,
        &[
            ctx.accounts.usdc_ata.to_account_info(),
            session_auth_info.to_account_info(),
            ctx.accounts.relayer_authority.to_account_info(),
            ctx.accounts.token_program.to_account_info(),
        ],
        &[signer_seeds],
    )?;

    invoke_relayer_signed(
        NTT_USDC_PROGRAM_ID,
        &NTT_TRANSFER_LOCK_IX,
        &transfer_args,
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

    /// CHECK: seed material only; validated transitively via the flow PDA.
    pub ntt_inbox_item: UncheckedAccount<'info>,

    #[account(
        mut,
        close = rent_destination,
        seeds = [FLOW_OUTBOUND_SEED, ntt_inbox_item.key().as_ref()],
        bump = outflight_flow.bump,
    )]
    pub outflight_flow: Account<'info, Flow>,

    /// CHECK: pinned to the flow PDA's stored `payer`; receives rent refund.
    #[account(mut, address = outflight_flow.payer)]
    pub rent_destination: UncheckedAccount<'info>,

    /// Singleton redemption tracker slot — must NOT currently exist. While
    /// any `RedemptionTracker` is alive, a sibling flow may be mid-redemption
    /// with its pre-balance snapshot pinned against this `usdc_ata`. A
    /// concurrent outflow here would poison that delta, causing
    /// `BalanceUnderflow` or silent user under-credit. Stuck redemptions
    /// are covered by `cancel_redemption_onyc` — deliberate
    /// correctness-over-latency trade.
    #[account(
        seeds = [REDEMPTION_TRACKER_SEED],
        bump,
    )]
    pub redemption_tracker: SystemAccount<'info>,

    pub token_program: Interface<'info, TokenInterface>,
}
