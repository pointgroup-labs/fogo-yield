use crate::{
    config::state::fee_config::{FeeConfig, FEE_CONFIG_SEED},
    error::IntentTransferError,
    fees::{PaidInstruction, VerifyAndCollectAccounts},
    intrachain::message::Message,
    nonce::{self, Nonce},
    verify::{verify_and_update_nonce, verify_signer_matches_source, verify_symbol_or_mint},
    INTENT_TRANSFER_SEED,
};
use anchor_lang::{prelude::*, solana_program::sysvar::instructions};
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{spl_token::try_ui_amount_into_amount, Mint, Token, TokenAccount},
};
use chain_id::ChainId;
use solana_intents::Intent;

#[derive(Accounts)]
pub struct SendTokens<'info> {
    #[account(seeds = [chain_id::SEED], seeds::program = chain_id::ID, bump)]
    pub chain_id: Account<'info, ChainId>,

    /// CHECK: we check the address of this account
    #[account(address = instructions::ID)]
    pub sysvar_instructions: UncheckedAccount<'info>,

    /// CHECK: this is just a signer for token program CPIs
    #[account(seeds = [INTENT_TRANSFER_SEED], bump)]
    pub intent_transfer_setter: UncheckedAccount<'info>,

    #[account(mut, token::mint = mint)]
    pub source: Box<Account<'info, TokenAccount>>,

    #[account(init_if_needed, payer = sponsor, associated_token::mint = mint, associated_token::authority = destination_owner)]
    pub destination: Box<Account<'info, TokenAccount>>,

    pub mint: Box<Account<'info, Mint>>,

    pub metadata: Option<UncheckedAccount<'info>>,

    #[account(
        init_if_needed,
        payer = sponsor,
        space = Nonce::DISCRIMINATOR.len() + Nonce::INIT_SPACE,
        seeds = [nonce::INTENT_TRANSFER_NONCE_SEED, source.owner.key().as_ref()],
        bump
    )]
    pub nonce: Account<'info, Nonce>,

    #[account(mut)]
    pub sponsor: Signer<'info>,

    /// CHECK: This account is checked against the signed message
    pub destination_owner: AccountInfo<'info>,

    #[account(seeds = [FEE_CONFIG_SEED, fee_mint.key().as_ref()], bump)]
    pub fee_config: Account<'info, FeeConfig>,

    #[account(mut, token::mint = fee_mint, token::authority = source.owner )]
    pub fee_source: Account<'info, TokenAccount>,

    #[account(mut, associated_token::mint = fee_mint, associated_token::authority = fee_config.fee_recipient)]
    pub fee_destination: Account<'info, TokenAccount>,

    pub fee_mint: Account<'info, Mint>,

    pub fee_metadata: Option<UncheckedAccount<'info>>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,

    /// Session (or wallet) authorizing the user-token debits via the FOGO
    /// session rail; the patched token program checks it against source.owner.
    pub signer_or_session: Signer<'info>,

    /// CHECK: per-program signer PDA; the patched token program enforces its
    /// presence-as-signer to prove this program is session-authorized.
    #[account(seeds = [crate::session_token::PROGRAM_SIGNER_SEED], bump)]
    pub program_signer: UncheckedAccount<'info>,
}

impl<'info> PaidInstruction<'info> for SendTokens<'info> {
    fn fee_amount(&self) -> u64 {
        self.fee_config.intrachain_transfer_fee
    }

    fn verify_and_collect_accounts<'a>(&'a self) -> VerifyAndCollectAccounts<'a, 'info> {
        let Self {
            fee_source,
            fee_destination,
            fee_mint,
            fee_metadata,
            signer_or_session,
            program_signer,
            token_program,
            ..
        } = self;
        VerifyAndCollectAccounts {
            fee_source,
            fee_destination,
            fee_mint,
            fee_metadata,
            signer_or_session,
            program_signer,
            token_program,
        }
    }
}

impl<'info> SendTokens<'info> {
    pub fn verify_and_send(&mut self, program_signer_seeds: &[&[&[u8]]]) -> Result<()> {
        let Self {
            chain_id,
            destination,
            signer_or_session,
            program_signer,
            metadata,
            mint,
            source,
            sysvar_instructions,
            token_program,
            nonce,
            destination_owner,
            ..
        } = self;

        let Intent {
            message:
                Message {
                    amount,
                    chain_id: expected_chain_id,
                    recipient,
                    symbol_or_mint,
                    nonce: new_nonce,
                    version: _,
                    fee_amount,
                    fee_symbol_or_mint,
                },
            signer,
        } = Intent::load(sysvar_instructions.as_ref())
            .map_err(Into::<IntentTransferError>::into)?;

        if chain_id.chain_id != expected_chain_id {
            return err!(IntentTransferError::ChainIdMismatch);
        }

        verify_symbol_or_mint(&symbol_or_mint, metadata, mint)?;
        verify_signer_matches_source(signer, source.owner)?;

        require_keys_eq!(
            recipient,
            destination_owner.key(),
            IntentTransferError::RecipientMismatch
        );

        verify_and_update_nonce(nonce, new_nonce)?;

        crate::session_token::in_session_transfer_checked(
            token_program.to_account_info(),
            source.to_account_info(),
            mint.to_account_info(),
            destination.to_account_info(),
            signer_or_session.to_account_info(),
            program_signer.to_account_info(),
            try_ui_amount_into_amount(amount, mint.decimals)?,
            mint.decimals,
            program_signer_seeds,
        )?;

        self.verify_and_collect_fee(fee_amount, fee_symbol_or_mint, program_signer_seeds)
    }
}
