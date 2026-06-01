//! Permissionless, route-agnostic outbound send for a swapped flow.
//!
//! Replaces `lock_onyc` + `send_usdc_to_user`. Routes on `flow.direction`:
//! deposit pushes the asset (ONyc) out, withdraw pushes the base (USDC) out.
//! Each leg locks via NTT and atomically publishes the outbound VAA to
//! `flow.recipient`. Closing the flow PDA returns rent and blocks replay.

use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::constants::{
    CONFIG_SEED, FOGO_WORMHOLE_CHAIN_ID, NTT_RELEASE_WORMHOLE_OUTBOUND_IX, NTT_TRANSFER_LOCK_IX,
    RELAYER_SEED,
};
use crate::cpi::{approve_ntt_session_authority, invoke_relayer_signed};
use crate::error::RelayerError;
use crate::events::Sent;
use crate::ntt::{derive_session_authority, NttReleaseOutboundArgs, NttTransferArgs};
use crate::state::{Direction, Flow, FlowStatus, RelayerConfig};

/// `transfer_lock_account_count` partitions `remaining_accounts`:
///   `[..N]` → NTT `transfer_lock`
///   `[N..]` → NTT `release_wormhole_outbound` (atomic VAA emission;
///             without it the OutboxItem queues without a VAA).
pub fn handler<'info>(
    ctx: Context<'info, Send<'info>>,
    transfer_lock_account_count: u8,
) -> Result<()> {
    let direction = ctx.accounts.flow.direction;
    require!(
        ctx.accounts.flow.status == FlowStatus::Swapped,
        RelayerError::FlowStatusMismatch
    );

    let amount = ctx.accounts.flow.amount;
    require!(amount > 0, RelayerError::ZeroAmountFlow);

    let recipient = ctx.accounts.flow.recipient;
    let ntt_program = crate::state::send_ntt_program(direction);

    // Deposit pushes the asset out; withdraw pushes the base out.
    let from_ata = match direction {
        Direction::Deposit => ctx.accounts.asset_ata.to_account_info(),
        Direction::Withdraw => ctx.accounts.base_ata.to_account_info(),
    };

    let transfer_args = NttTransferArgs {
        amount,
        recipient_chain: FOGO_WORMHOLE_CHAIN_ID,
        recipient_address: recipient,
        should_queue: false,
    };

    // NTT binds session-authority to a hash of the transfer args.
    let (session_authority, _) = derive_session_authority(
        &ntt_program,
        &ctx.accounts.relayer_authority.key(),
        &transfer_args,
    );

    let bump = ctx.accounts.relayer_config.relayer_authority_bump;

    approve_ntt_session_authority(
        &ctx.accounts.token_program.to_account_info(),
        &from_ata,
        &ctx.accounts.relayer_authority.to_account_info(),
        bump,
        session_authority,
        ctx.remaining_accounts,
        amount,
    )?;

    // Split AFTER pre-CPI checks so failure-path tests with stub
    // remaining_accounts trip those errors first.
    let split = transfer_lock_account_count as usize;
    require!(
        ctx.remaining_accounts.len() > split,
        RelayerError::InvalidAccountSplit,
    );
    let (transfer_lock_accs, release_accs) = ctx.remaining_accounts.split_at(split);

    let authority = ctx.accounts.relayer_authority.to_account_info();

    invoke_relayer_signed(
        ntt_program,
        &NTT_TRANSFER_LOCK_IX,
        &transfer_args,
        transfer_lock_accs,
        Some(&authority),
        bump,
    )?;

    // Atomic VAA emission. NTT separates queue (transfer_lock) from
    // attestation (release_wormhole_outbound); doing both here closes
    // the "OutboxItem queued but never released" failure mode.
    invoke_relayer_signed(
        ntt_program,
        &NTT_RELEASE_WORMHOLE_OUTBOUND_IX,
        &NttReleaseOutboundArgs {
            revert_on_delay: false,
        },
        release_accs,
        None,
        bump,
    )?;

    emit!(Sent {
        flow: ctx.accounts.flow.key(),
        ntt_inbox_item: ctx.accounts.ntt_inbox_item.key(),
        recipient,
        direction,
        amount,
    });

    Ok(())
}

#[derive(Accounts)]
pub struct Send<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        seeds = [CONFIG_SEED],
        bump = relayer_config.bump,
        has_one = base_mint,
        has_one = asset_mint,
    )]
    pub relayer_config: Account<'info, RelayerConfig>,

    /// CHECK: PDA derived from RELAYER_SEED.
    #[account(seeds = [RELAYER_SEED], bump = relayer_config.relayer_authority_bump)]
    pub relayer_authority: UncheckedAccount<'info>,

    pub base_mint: InterfaceAccount<'info, Mint>,
    pub asset_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = base_mint,
        associated_token::authority = relayer_authority,
        associated_token::token_program = token_program,
    )]
    pub base_ata: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = asset_mint,
        associated_token::authority = relayer_authority,
        associated_token::token_program = token_program,
    )]
    pub asset_ata: InterfaceAccount<'info, TokenAccount>,

    /// CHECK: seed material only; validated transitively via the flow PDA.
    pub ntt_inbox_item: UncheckedAccount<'info>,

    #[account(
        mut,
        close = rent_destination,
        seeds = [crate::state::flow_seed(flow.direction), ntt_inbox_item.key().as_ref()],
        bump = flow.bump,
    )]
    pub flow: Account<'info, Flow>,

    /// CHECK: pinned to the flow PDA's stored `payer`; receives rent refund.
    #[account(mut, address = flow.payer)]
    pub rent_destination: UncheckedAccount<'info>,

    pub token_program: Interface<'info, TokenInterface>,
}
