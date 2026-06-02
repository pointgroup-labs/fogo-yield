use anchor_lang::prelude::*;
use anchor_spl::token::spl_token::try_ui_amount_into_amount;
use anchor_spl::token::{Mint, Token, TokenAccount};
use solana_intents::SymbolOrMint;

use crate::{
    error::IntentTransferError, session_token::in_session_transfer_checked,
    verify::verify_symbol_or_mint,
};

pub struct VerifyAndCollectAccounts<'a, 'info> {
    pub fee_source: &'a Account<'info, TokenAccount>,
    pub fee_destination: &'a Account<'info, TokenAccount>,
    pub fee_mint: &'a Account<'info, Mint>,
    pub fee_metadata: &'a Option<UncheckedAccount<'info>>,
    pub signer_or_session: &'a Signer<'info>,
    pub program_signer: &'a UncheckedAccount<'info>,
    pub token_program: &'a Program<'info, Token>,
}
pub trait PaidInstruction<'info> {
    fn fee_amount(&self) -> u64;

    fn verify_and_collect_accounts<'a>(&'a self) -> VerifyAndCollectAccounts<'a, 'info>;

    /// Debits the fee from `fee_source` (owner = user) via the FOGO session rail.
    /// `program_signer_seeds` must sign for `program_signer`.
    fn verify_and_collect_fee(
        &self,
        intent_fee_amount: String,
        fee_symbol_or_mint: SymbolOrMint,
        program_signer_seeds: &[&[&[u8]]],
    ) -> Result<()> {
        let VerifyAndCollectAccounts {
            fee_source,
            fee_destination,
            fee_mint,
            fee_metadata,
            signer_or_session,
            program_signer,
            token_program,
        } = self.verify_and_collect_accounts();

        verify_symbol_or_mint(&fee_symbol_or_mint, fee_metadata, fee_mint)?;
        let intent_fee_amount = try_ui_amount_into_amount(intent_fee_amount, fee_mint.decimals)?;
        let fee_amount = self.fee_amount();
        require_gte!(
            intent_fee_amount,
            fee_amount,
            IntentTransferError::InsufficientFeeAmount
        );

        in_session_transfer_checked(
            token_program.to_account_info(),
            fee_source.to_account_info(),
            fee_mint.to_account_info(),
            fee_destination.to_account_info(),
            signer_or_session.to_account_info(),
            program_signer.to_account_info(),
            fee_amount,
            fee_mint.decimals,
            program_signer_seeds,
        )
    }
}
