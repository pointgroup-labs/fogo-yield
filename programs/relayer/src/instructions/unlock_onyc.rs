use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::constants::{
    CONFIG_SEED, FLOW_OUTBOUND_SEED, NTT_PROGRAM_ID, NTT_REDEEM_IX, NTT_RELEASE_INBOUND_UNLOCK_IX,
    RELAYER_SEED,
};
use crate::cpi::invoke_relayer_signed;
use crate::error::RelayerError;
use crate::events::OnycUnlocked;
use crate::ntt::{
    NttRedeemArgs, NttReleaseInboundArgs, TRANSCEIVER_MESSAGE_SENDER_OFFSET,
    VALIDATED_TRANSCEIVER_MESSAGE_DISC,
};
use crate::state::{Flow, FlowStatus, RelayerConfig};

// ── Upstream NTT account indices ───────────────────────────────────────
//
// These mirror the field order of upstream NTT's `#[derive(Accounts)]`
// structs. The `redeem` / `release_inbound_unlock` CPIs consume accounts
// *positionally*, so if upstream ever reorders its struct fields, these
// constants MUST be updated in lockstep — otherwise our positional
// binding checks would silently guard the wrong slots, re-opening the
// decouple-sender-from-recipient attack the checks exist to prevent.
//
// Upstream source:
//   `example-native-token-transfers/programs/…/src/instructions/redeem.rs`
//   `…/src/instructions/release_inbound.rs`

/// Expected minimum length of the `redeem` account slice.
const REDEEM_ACCOUNTS_MIN_LEN: usize = 10;
/// Expected minimum length of the `release_inbound_unlock` account slice.
const RELEASE_ACCOUNTS_MIN_LEN: usize = 8;

/// Index of `ValidatedTransceiverMessage` in NTT's `Redeem` accounts.
const REDEEM_IDX_TRANSCEIVER_MESSAGE: usize = 3;
/// Index of `InboxItem` in NTT's `Redeem` accounts.
const REDEEM_IDX_INBOX_ITEM: usize = 6;
/// Index of `InboxItem` in NTT's `ReleaseInboundUnlock` accounts.
const RELEASE_IDX_INBOX_ITEM: usize = 2;
/// Index of the recipient token account in NTT's `ReleaseInboundUnlock`.
const RELEASE_IDX_RECIPIENT_ATA: usize = 3;

/// Release ONyc from NTT custody for an incoming VAA from FOGO, and
/// record a `Flow` receipt that binds the eventual USDC return to the
/// FOGO user who initiated the withdrawal.
///
/// Permissionless — anyone can crank. Safety:
///
/// * The NTT `redeem` CPI validates guardian signatures (via the
///   `ValidatedTransceiverMessage` account, whose owner must equal the
///   registered transceiver address). A forged VAA fails inside the CPI.
///
/// * `fogo_sender` is parsed from on-chain `ValidatedTransceiverMessage`
///   data — specifically `NttManagerMessage.sender`, which the FOGO side
///   of the transfer sets to the user's wallet. The caller cannot supply
///   arbitrary bytes here; Anchor's `owner = NTT_PROGRAM_ID` constraint
///   plus the account's discriminator check reject any impostor account.
///
/// `remaining_accounts` holds both CPIs' account lists concatenated;
/// `redeem_accounts_len` is the split point.
pub fn handler<'info>(
    ctx: Context<'info, UnlockOnyc<'info>>,
    redeem_accounts_len: u8,
) -> Result<()> {
    // Parse fogo_sender from the validated transceiver message. Anchor's
    // `owner = NTT_PROGRAM_ID` constraint already pins the writer; we add
    // a discriminator check before trusting the offset.
    let data = ctx.accounts.ntt_transceiver_message.try_borrow_data()?;
    require!(
        data.len() >= TRANSCEIVER_MESSAGE_SENDER_OFFSET + 32,
        RelayerError::InvalidTransceiverMessage
    );
    require!(
        data[..8] == VALIDATED_TRANSCEIVER_MESSAGE_DISC,
        RelayerError::InvalidTransceiverMessage
    );
    let mut fogo_sender = [0u8; 32];
    fogo_sender.copy_from_slice(
        &data[TRANSCEIVER_MESSAGE_SENDER_OFFSET..TRANSCEIVER_MESSAGE_SENDER_OFFSET + 32],
    );
    require!(fogo_sender != [0u8; 32], RelayerError::ZeroFogoSender);
    drop(data);

    let split = redeem_accounts_len as usize;
    let total = ctx.remaining_accounts.len();
    require!(
        split > 0 && split < total,
        RelayerError::InvalidAccountSplit
    );
    let (redeem_accs, release_accs) = ctx.remaining_accounts.split_at(split);

    // Pin named accounts to the NTT CPIs' positional slots. See the block
    // comment at the top of this file for the attack this prevents.
    require!(
        redeem_accs.len() >= REDEEM_ACCOUNTS_MIN_LEN
            && release_accs.len() >= RELEASE_ACCOUNTS_MIN_LEN,
        RelayerError::InvalidAccountSplit
    );
    require!(
        redeem_accs[REDEEM_IDX_TRANSCEIVER_MESSAGE].key()
            == ctx.accounts.ntt_transceiver_message.key(),
        RelayerError::TransceiverMessageMismatch
    );
    require!(
        redeem_accs[REDEEM_IDX_INBOX_ITEM].key() == ctx.accounts.ntt_inbox_item.key(),
        RelayerError::InboxItemMismatch
    );
    require!(
        release_accs[RELEASE_IDX_INBOX_ITEM].key() == ctx.accounts.ntt_inbox_item.key(),
        RelayerError::InboxItemMismatch
    );
    require!(
        release_accs[RELEASE_IDX_RECIPIENT_ATA].key() == ctx.accounts.onyc_ata.key(),
        RelayerError::RecipientAtaMismatch
    );

    let bump = ctx.accounts.relayer_config.relayer_authority_bump;
    let authority = ctx.accounts.relayer_authority.to_account_info();

    // Snapshot pre-CPI balance so we can compute the delta.
    let pre_balance = ctx.accounts.onyc_ata.amount;

    invoke_relayer_signed(
        NTT_PROGRAM_ID,
        &NTT_REDEEM_IX,
        &NttRedeemArgs {},
        redeem_accs,
        &authority,
        bump,
    )?;

    invoke_relayer_signed(
        NTT_PROGRAM_ID,
        &NTT_RELEASE_INBOUND_UNLOCK_IX,
        &NttReleaseInboundArgs {
            revert_on_delay: false,
        },
        release_accs,
        &authority,
        bump,
    )?;

    // Delta = what this specific VAA released.
    ctx.accounts.onyc_ata.reload()?;
    let amount = ctx
        .accounts
        .onyc_ata
        .amount
        .checked_sub(pre_balance)
        .ok_or(RelayerError::BalanceUnderflow)?;
    require!(amount > 0, RelayerError::ZeroAmountFlow);

    let flow_key = ctx.accounts.outflight_flow.key();

    let flow = &mut ctx.accounts.outflight_flow;
    flow.fogo_sender = fogo_sender;
    flow.status = FlowStatus::Claimed;
    flow.amount = amount;
    flow.payer = ctx.accounts.payer.key();
    flow.bump = ctx.bumps.outflight_flow;

    emit!(OnycUnlocked {
        flow: flow_key,
        ntt_inbox_item: ctx.accounts.ntt_inbox_item.key(),
        fogo_sender,
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

    /// NTT `ValidatedTransceiverMessage` for this inbound transfer — same
    /// account that the caller must pass to the `redeem` CPI in
    /// `remaining_accounts`. We parse `fogo_sender` directly from its
    /// already-validated bytes. The `owner` constraint pins the writer to
    /// the NTT program (which for OnRe's deployment is also the transceiver
    /// program), so nothing outside NTT can have crafted this data.
    /// CHECK: owner + discriminator + offset checks in the handler.
    #[account(owner = NTT_PROGRAM_ID)]
    pub ntt_transceiver_message: UncheckedAccount<'info>,

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
