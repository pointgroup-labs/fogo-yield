use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::constants::{
    CONFIG_SEED, FLOW_OUTBOUND_SEED, NTT_PROGRAM_ID, NTT_REDEEM_IX, NTT_RELEASE_INBOUND_UNLOCK_IX,
    RELAYER_SEED,
};
use crate::cpi::invoke_relayer_signed;
use crate::error::RelayerError;
use crate::events::OnycUnlocked;
use crate::state::{Flow, FlowStatus, RelayerConfig};

#[derive(AnchorSerialize, AnchorDeserialize)]
struct RedeemArgs {
    vaa: Vec<u8>,
}

#[derive(AnchorSerialize, AnchorDeserialize)]
struct ReleaseInboundArgs {
    revert_on_delay: bool,
}

/// Release ONyc from NTT custody for an incoming VAA from FOGO, and
/// record a `Flow` receipt that binds the eventual USDC return to the
/// FOGO user who initiated the withdrawal.
///
/// Permissionless — anyone can crank this instruction. Safety: the NTT
/// program verifies guardian signatures during the `redeem` CPI. A forged
/// VAA always fails the CPI, so a forged `fogo_sender` can never be
/// persisted.
///
/// `remaining_accounts` holds both CPIs' account lists concatenated;
/// `redeem_accounts_len` is the split point.
pub fn handler<'info>(
    ctx: Context<'info, UnlockOnyc<'info>>,
    vaa: Vec<u8>,
    redeem_accounts_len: u8,
) -> Result<()> {
    require!(vaa.len() >= 32, RelayerError::VaaPayloadTooShort);
    let mut fogo_sender = [0u8; 32];
    fogo_sender.copy_from_slice(&vaa[vaa.len() - 32..]);
    require!(fogo_sender != [0u8; 32], RelayerError::ZeroFogoSender);

    let split = redeem_accounts_len as usize;
    let total = ctx.remaining_accounts.len();
    require!(
        split > 0 && split < total,
        RelayerError::InvalidAccountSplit
    );
    let (redeem_accs, release_accs) = ctx.remaining_accounts.split_at(split);
    let bump = ctx.accounts.relayer_config.relayer_authority_bump;
    let authority = ctx.accounts.relayer_authority.to_account_info();

    // Snapshot pre-CPI balance so we can compute the delta
    let pre_balance = ctx.accounts.onyc_ata.amount;

    invoke_relayer_signed(
        NTT_PROGRAM_ID,
        &NTT_REDEEM_IX,
        &RedeemArgs { vaa },
        redeem_accs,
        &authority,
        bump,
    )?;

    invoke_relayer_signed(
        NTT_PROGRAM_ID,
        &NTT_RELEASE_INBOUND_UNLOCK_IX,
        &ReleaseInboundArgs {
            revert_on_delay: false,
        },
        release_accs,
        &authority,
        bump,
    )?;

    // Delta = what this specific VAA released
    ctx.accounts.onyc_ata.reload()?;
    let amount = ctx.accounts.onyc_ata.amount
        .checked_sub(pre_balance)
        .ok_or(RelayerError::BalanceUnderflow)?;
    let bps = ctx.accounts.relayer_config.withdraw_fee_bps as u128;
    let fee = (amount as u128)
        .checked_mul(bps)
        .ok_or(RelayerError::FeeOverflow)?
        / 10_000;
    let net_amount = amount
        .checked_sub(fee as u64)
        .ok_or(RelayerError::FeeOverflow)?;
    require!(net_amount > 0, RelayerError::ZeroAmountFlow);
    let flow_key = ctx.accounts.outflight_flow.key();

    let flow = &mut ctx.accounts.outflight_flow;
    flow.fogo_sender = fogo_sender;
    flow.status = FlowStatus::Claimed;
    flow.amount = net_amount;
    flow.payer = ctx.accounts.payer.key();
    flow.bump = ctx.bumps.outflight_flow;

    emit!(OnycUnlocked {
        ntt_inbox_item: ctx.accounts.ntt_inbox_item.key(),
        fogo_sender,
        flow: flow_key,
        amount,
    });

    Ok(())
}

#[derive(Accounts)]
pub struct UnlockOnyc<'info> {
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

    /// NTT inbox-item PDA. Created by the NTT `redeem` CPI; we use its
    /// pubkey as unique seed material for the flow PDA.
    /// CHECK: validated by the NTT CPI — any forgery makes the CPI fail.
    pub ntt_inbox_item: UncheckedAccount<'info>,

    /// One-shot receipt PDA for the withdrawal leg. `init` fails on
    /// replay (same NTT inbox → same PDA → already exists).
    #[account(
        init,
        payer = payer,
        space = 8 + Flow::INIT_SPACE,
        seeds = [FLOW_OUTBOUND_SEED, ntt_inbox_item.key().as_ref()],
        bump,
    )]
    pub outflight_flow: Account<'info, Flow>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}
