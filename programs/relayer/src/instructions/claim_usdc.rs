use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::constants::{
    CONFIG_SEED, FLOW_INBOUND_SEED, GATEWAY_COMPLETE_TRANSFER_IX, GATEWAY_PROGRAM_ID, RELAYER_SEED,
    WORMHOLE_CORE_BRIDGE_ID,
};
use crate::cpi::invoke_relayer_signed;
use crate::error::RelayerError;
use crate::events::UsdcClaimed;
use crate::state::{Flow, FlowStatus, RelayerConfig};
use crate::vaa::parse_fogo_sender_from_posted_vaa;

/// Claim incoming USDC bridged from FOGO via Wormhole Gateway, and record
/// a `Flow` receipt that binds the eventual ONyc return to the original
/// FOGO user's wallet.
///
/// Permissionless — anyone can crank this instruction. Safety comes from:
/// - `fogo_sender` is parsed from the posted-VAA (guardian-signed, not
///   caller-supplied)
/// - Flow PDA is seeded by the Gateway claim account (CPI-created, unforgeable)
/// - `init` prevents double-claims
///
/// `remaining_accounts` must contain the full Gateway account list in
/// the order Gateway expects, including the relayer authority PDA and the
/// relayer's USDC ATA.
pub fn handler<'info>(ctx: Context<'info, ClaimUsdc<'info>>) -> Result<()> {
    let vaa_data = ctx.accounts.posted_vaa.try_borrow_data()?;
    let fogo_sender = parse_fogo_sender_from_posted_vaa(&vaa_data)?;
    drop(vaa_data);

    // Snapshot pre-CPI balance so we can compute the delta
    let pre_balance = ctx.accounts.usdc_ata.amount;

    invoke_relayer_signed(
        GATEWAY_PROGRAM_ID,
        &GATEWAY_COMPLETE_TRANSFER_IX,
        &(),
        ctx.remaining_accounts,
        &ctx.accounts.relayer_authority.to_account_info(),
        ctx.accounts.relayer_config.relayer_authority_bump,
    )?;

    // Delta = what this specific VAA deposited
    ctx.accounts.usdc_ata.reload()?;
    let amount = ctx.accounts.usdc_ata.amount
        .checked_sub(pre_balance)
        .ok_or(RelayerError::BalanceUnderflow)?;
    let bps = ctx.accounts.relayer_config.deposit_fee_bps as u128;
    let fee = (amount as u128)
        .checked_mul(bps)
        .ok_or(RelayerError::FeeOverflow)?
        / 10_000;
    let net_amount = amount
        .checked_sub(fee as u64)
        .ok_or(RelayerError::FeeOverflow)?;
    require!(net_amount > 0, RelayerError::ZeroAmountFlow);
    let flow_key = ctx.accounts.inflight_flow.key();

    let flow = &mut ctx.accounts.inflight_flow;
    flow.fogo_sender = fogo_sender;
    flow.status = FlowStatus::Claimed;
    flow.amount = net_amount;
    flow.payer = ctx.accounts.payer.key();
    flow.bump = ctx.bumps.inflight_flow;

    emit!(UsdcClaimed {
        gateway_claim: ctx.accounts.gateway_claim.key(),
        fogo_sender,
        flow: flow_key,
        amount,
    });

    Ok(())
}

#[derive(Accounts)]
pub struct ClaimUsdc<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        seeds = [CONFIG_SEED],
        bump = relayer_config.bump,
        has_one = usdc_mint,
    )]
    pub relayer_config: Account<'info, RelayerConfig>,

    /// CHECK: PDA derived from RELAYER_SEED; no data stored.
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

    /// Wormhole posted-VAA account. We read `fogo_sender` from its on-chain
    /// data (guardian-signed) rather than trusting an instruction argument.
    /// CHECK: owner validated as Wormhole core bridge program.
    #[account(owner = WORMHOLE_CORE_BRIDGE_ID)]
    pub posted_vaa: UncheckedAccount<'info>,

    /// Wormhole Gateway's per-VAA claim PDA. Created by the Gateway CPI;
    /// we use its pubkey as unique seed material for the flow PDA.
    /// CHECK: validated by the Gateway CPI — any forgery makes the CPI fail.
    pub gateway_claim: UncheckedAccount<'info>,

    /// One-shot flow receipt. `init` fails if a flow for this claim PDA
    /// already exists (double-claim protection).
    #[account(
        init,
        payer = payer,
        space = 8 + Flow::INIT_SPACE,
        seeds = [FLOW_INBOUND_SEED, gateway_claim.key().as_ref()],
        bump,
    )]
    pub inflight_flow: Account<'info, Flow>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}
