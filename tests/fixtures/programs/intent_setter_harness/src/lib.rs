//! Test-only harness standing in for the intent-transfer fork's
//! `bridge_ntt_tokens` source debit. Loaded at the fork program id.
//!
//! Two debit shapes, selected by account count:
//!   5 accounts: source(w), mint, dest(w), setter(signer-PDA), token_program.
//!     Signs `transfer_checked` as PDA([b"intent_transfer"], fork_id) — the
//!     legacy setter-authority path (delegate-auth differential test).
//!   6 accounts: source(w), mint, dest(w), session(signer), program_signer,
//!     token_program. Emits the canonical FOGO in-session `transfer_checked`:
//!     authority = session, with program_signer = PDA([b"fogo_session_
//!     program_signer"], fork_id) appended as a 5th readonly+signer meta and
//!     signed via `invoke_signed`.
//!
//! Instruction data: `[amount: u64 LE][decimals: u8]`.

use solana_program::account_info::{next_account_info, AccountInfo};
use solana_program::entrypoint;
use solana_program::entrypoint::ProgramResult;
use solana_program::instruction::{AccountMeta, Instruction};
use solana_program::program::invoke_signed;
use solana_program::program_error::ProgramError;
use solana_program::pubkey::Pubkey;

const INTENT_TRANSFER_SEED: &[u8] = b"intent_transfer";
const PROGRAM_SIGNER_SEED: &[u8] = b"fogo_session_program_signer";

/// SPL Token `TransferChecked` instruction discriminator.
const TRANSFER_CHECKED_IX: u8 = 12;

entrypoint!(process_instruction);

fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let amount = data.get(0..8).ok_or(ProgramError::InvalidInstructionData)?;
    let amount = u64::from_le_bytes(amount.try_into().unwrap());
    let decimals = *data.get(8).ok_or(ProgramError::InvalidInstructionData)?;

    match accounts.len() {
        5 => setter_debit(program_id, accounts, amount, decimals),
        6 => session_debit(program_id, accounts, amount, decimals),
        _ => Err(ProgramError::NotEnoughAccountKeys),
    }
}

/// Legacy setter-PDA authority path.
fn setter_debit(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    amount: u64,
    decimals: u8,
) -> ProgramResult {
    let it = &mut accounts.iter();
    let source = next_account_info(it)?;
    let mint = next_account_info(it)?;
    let dest = next_account_info(it)?;
    let setter = next_account_info(it)?;
    let token_program = next_account_info(it)?;

    let (expected_setter, bump) =
        Pubkey::find_program_address(&[INTENT_TRANSFER_SEED], program_id);
    if expected_setter != *setter.key {
        return Err(ProgramError::InvalidSeeds);
    }

    let ix = Instruction {
        program_id: *token_program.key,
        accounts: vec![
            AccountMeta::new(*source.key, false),
            AccountMeta::new_readonly(*mint.key, false),
            AccountMeta::new(*dest.key, false),
            AccountMeta::new_readonly(*setter.key, true),
        ],
        data: transfer_checked_data(amount, decimals),
    };

    invoke_signed(
        &ix,
        &[
            source.clone(),
            mint.clone(),
            dest.clone(),
            setter.clone(),
            token_program.clone(),
        ],
        &[&[INTENT_TRANSFER_SEED, &[bump]]],
    )
}

/// Canonical FOGO in-session transfer: session authority + program-signer PDA.
fn session_debit(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    amount: u64,
    decimals: u8,
) -> ProgramResult {
    let it = &mut accounts.iter();
    let source = next_account_info(it)?;
    let mint = next_account_info(it)?;
    let dest = next_account_info(it)?;
    let session = next_account_info(it)?;
    let program_signer = next_account_info(it)?;
    let token_program = next_account_info(it)?;

    let (expected_signer, bump) =
        Pubkey::find_program_address(&[PROGRAM_SIGNER_SEED], program_id);
    if expected_signer != *program_signer.key {
        return Err(ProgramError::InvalidSeeds);
    }

    let ix = Instruction {
        program_id: *token_program.key,
        accounts: vec![
            AccountMeta::new(*source.key, false),
            AccountMeta::new_readonly(*mint.key, false),
            AccountMeta::new(*dest.key, false),
            AccountMeta::new_readonly(*session.key, true),
            AccountMeta::new_readonly(*program_signer.key, true),
        ],
        data: transfer_checked_data(amount, decimals),
    };

    invoke_signed(
        &ix,
        &[
            source.clone(),
            mint.clone(),
            dest.clone(),
            session.clone(),
            program_signer.clone(),
            token_program.clone(),
        ],
        &[&[PROGRAM_SIGNER_SEED, &[bump]]],
    )
}

fn transfer_checked_data(amount: u64, decimals: u8) -> Vec<u8> {
    let mut ix_data = Vec::with_capacity(10);
    ix_data.push(TRANSFER_CHECKED_IX);
    ix_data.extend_from_slice(&amount.to_le_bytes());
    ix_data.push(decimals);
    ix_data
}
