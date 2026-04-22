use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked,
};

use crate::constants::{
    CONFIG_SEED, FLOW_INBOUND_SEED, GATEWAY_COMPLETE_TRANSFER_IX, GATEWAY_PROGRAM_ID,
    REDEEMER_SEED, RELAYER_SEED, WORMHOLE_CORE_BRIDGE_ID,
};
use crate::cpi::invoke_relayer_signed_with_redeemer;
use crate::error::RelayerError;
use crate::events::UsdcClaimed;
use crate::state::{Flow, FlowStatus, RelayerConfig};
use crate::vaa::parse_fogo_sender_from_posted_vaa;

// ── Upstream Token Bridge account indices ───────────────────────────────
//
// These mirror the positional account layout of Wormhole Token Bridge's
// `CompleteWrappedWithPayload` (Solitaire) instruction. Because the CPI
// reads the VAA and creates its claim PDA *positionally* from
// `remaining_accounts`, we MUST pin the caller-supplied `posted_vaa` and
// `gateway_claim` named accounts to those same slots. Otherwise a caller
// could pass VAA_A at the positional slot (so TB mints VAA_A's USDC) while
// handing VAA_B as `posted_vaa` (so we parse Bob-the-attacker's wallet as
// `fogo_sender` and lock_onyc later ships bONyc to Bob instead of Alice).
//
// Upstream source:
//   `wormhole/solana/modules/token_bridge/program/src/api/complete_transfer.rs`
//   `CompleteWrappedWithPayload` account struct.

/// Index of the posted-VAA account in TB's `CompleteWrappedWithPayload`.
const TB_IDX_POSTED_VAA: usize = 2;
/// Index of the claim PDA in TB's `CompleteWrappedWithPayload`.
const TB_IDX_GATEWAY_CLAIM: usize = 3;
/// Minimum length of TB's `CompleteWrappedWithPayload` account list,
/// up to and including the slots we bind against. The SDK helper
/// `buildClaimWrappedRemainingAccounts` supplies 17 entries (14 TB
/// accounts + 2 program IDs + 1 trailing relayer-authority PDA used by
/// our own CPI helper); we only assert on the minimum we actually read.
const TB_ACCOUNTS_MIN_LEN: usize = TB_IDX_GATEWAY_CLAIM + 1;

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
/// ## Two-stage token flow
///
/// Token Bridge's `CompleteWrappedWithPayload` requires
/// `redeemer.key == to.owner` for the destination token account. Rather than
/// unify the relayer authority and redeemer into the same PDA (which would
/// relocate every long-lived ATA), we use a **short-lived intake ATA owned
/// by the redeemer PDA** as the TB `to` account. After the CPI, we
/// immediately sweep the received USDC from the redeemer-owned intake ATA
/// into the main authority-owned USDC ATA (signed by the redeemer PDA).
/// From that point on, the rest of the pipeline operates on `usdc_ata` as
/// before.
///
/// `remaining_accounts` must contain the full Gateway account list in
/// the order Gateway expects, including the redeemer PDA at whichever index
/// TB expects it and the relayer authority PDA appended so the CPI helper
/// can force its signer flag.
pub fn handler<'info>(ctx: Context<'info, ClaimUsdc<'info>>) -> Result<()> {
    // Pin named accounts to TB's positional slots. See the block comment
    // at the top of this file for the attack this prevents.
    require!(
        ctx.remaining_accounts.len() >= TB_ACCOUNTS_MIN_LEN,
        RelayerError::InvalidAccountSplit
    );
    require!(
        ctx.remaining_accounts[TB_IDX_POSTED_VAA].key() == ctx.accounts.posted_vaa.key(),
        RelayerError::PostedVaaMismatch
    );
    require!(
        ctx.remaining_accounts[TB_IDX_GATEWAY_CLAIM].key() == ctx.accounts.gateway_claim.key(),
        RelayerError::GatewayClaimMismatch
    );

    let vaa_data = ctx.accounts.posted_vaa.try_borrow_data()?;
    let fogo_sender = parse_fogo_sender_from_posted_vaa(&vaa_data)?;
    drop(vaa_data);

    // Snapshot pre-CPI balance of the intake ATA so we can compute the delta.
    let pre_intake_balance = ctx.accounts.redeemer_usdc_ata.amount;

    let redeemer_key = ctx.accounts.redeemer_authority.key();
    let redeemer_bump = ctx.bumps.redeemer_authority;

    invoke_relayer_signed_with_redeemer(
        GATEWAY_PROGRAM_ID,
        &GATEWAY_COMPLETE_TRANSFER_IX,
        &(),
        ctx.remaining_accounts,
        &ctx.accounts.relayer_authority.to_account_info(),
        ctx.accounts.relayer_config.relayer_authority_bump,
        redeemer_key,
        redeemer_bump,
    )?;

    // Delta = what this specific VAA minted into the redeemer intake ATA.
    ctx.accounts.redeemer_usdc_ata.reload()?;
    let amount = ctx
        .accounts
        .redeemer_usdc_ata
        .amount
        .checked_sub(pre_intake_balance)
        .ok_or(RelayerError::BalanceUnderflow)?;
    require!(amount > 0, RelayerError::ZeroAmountFlow);

    // Sweep the freshly-minted USDC into the main authority-owned ATA,
    // signed by the redeemer PDA. Everything downstream reads from
    // `usdc_ata` as before.
    let bump_arr = [redeemer_bump];
    let signer_seeds: &[&[&[u8]]] = &[&[REDEEMER_SEED, &bump_arr]];
    transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            TransferChecked {
                from: ctx.accounts.redeemer_usdc_ata.to_account_info(),
                mint: ctx.accounts.usdc_mint.to_account_info(),
                to: ctx.accounts.usdc_ata.to_account_info(),
                authority: ctx.accounts.redeemer_authority.to_account_info(),
            },
            signer_seeds,
        ),
        amount,
        ctx.accounts.usdc_mint.decimals,
    )?;

    let (net_amount, fee_amount) = ctx.accounts.relayer_config.apply_deposit_fee(amount)?;
    let flow_key = ctx.accounts.inflight_flow.key();

    let flow = &mut ctx.accounts.inflight_flow;
    flow.fogo_sender = fogo_sender;
    flow.status = FlowStatus::Claimed;
    flow.amount = net_amount;
    flow.payer = ctx.accounts.payer.key();
    flow.bump = ctx.bumps.inflight_flow;

    emit!(UsdcClaimed {
        flow: flow_key,
        gateway_claim: ctx.accounts.gateway_claim.key(),
        fogo_sender,
        gross_amount: amount,
        fee_amount,
        net_amount,
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

    /// Redeemer PDA — signs the Token Bridge CPI and the post-CPI sweep.
    /// CHECK: PDA derived from REDEEMER_SEED; no data stored.
    #[account(seeds = [REDEEMER_SEED], bump)]
    pub redeemer_authority: UncheckedAccount<'info>,

    pub usdc_mint: InterfaceAccount<'info, Mint>,

    /// Long-lived USDC ATA owned by the relayer authority PDA; the final
    /// destination of the claim. Populated by the post-CPI sweep.
    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = relayer_authority,
        associated_token::token_program = token_program,
    )]
    pub usdc_ata: InterfaceAccount<'info, TokenAccount>,

    /// Short-lived USDC intake ATA owned by the redeemer PDA. TB mints
    /// directly into this account during `CompleteWrappedWithPayload`;
    /// we then sweep the balance into `usdc_ata` in the same instruction.
    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = redeemer_authority,
        associated_token::token_program = token_program,
    )]
    pub redeemer_usdc_ata: InterfaceAccount<'info, TokenAccount>,

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
