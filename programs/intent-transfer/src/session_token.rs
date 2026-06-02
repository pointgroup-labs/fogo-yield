//! Canonical FOGO in-session token transfer for gasless user-token debits.
//!
//! FOGO's patched token program blesses a non-owner mover when the authority is
//! a session account whose `Session.user == source.owner` and whose authorized
//! programs include the caller — proven by the caller's program-signer PDA being
//! present among the transfer's extra accounts as a signer. Anchor's
//! `TransferChecked` CPI can't append that 5th meta, so we build the raw
//! `transfer_checked` (disc 12) and `invoke_signed` it with the program-signer
//! seeds.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
use anchor_lang::solana_program::program::invoke_signed;

/// Seed of the per-program signer PDA the session rail requires; mirrors
/// `fogo_sessions_sdk::token::PROGRAM_SIGNER_SEED`.
pub const PROGRAM_SIGNER_SEED: &[u8] = b"fogo_session_program_signer";

/// SPL Token `TransferChecked` instruction discriminator.
const TRANSFER_CHECKED_IX: u8 = 12;

/// Emit a `transfer_checked` authorized by a session, with `program_signer`
/// (PDA([PROGRAM_SIGNER_SEED], this program)) appended as the in-session signer.
/// `signer_seeds` must sign for `program_signer`.
#[allow(clippy::too_many_arguments)]
pub fn in_session_transfer_checked<'info>(
    token_program: AccountInfo<'info>,
    source: AccountInfo<'info>,
    mint: AccountInfo<'info>,
    destination: AccountInfo<'info>,
    authority: AccountInfo<'info>,
    program_signer: AccountInfo<'info>,
    amount: u64,
    decimals: u8,
    signer_seeds: &[&[&[u8]]],
) -> Result<()> {
    let mut data = Vec::with_capacity(10);
    data.push(TRANSFER_CHECKED_IX);
    data.extend_from_slice(&amount.to_le_bytes());
    data.push(decimals);

    let ix = Instruction {
        program_id: *token_program.key,
        accounts: vec![
            AccountMeta::new(*source.key, false),
            AccountMeta::new_readonly(*mint.key, false),
            AccountMeta::new(*destination.key, false),
            AccountMeta::new_readonly(*authority.key, true),
            AccountMeta::new_readonly(*program_signer.key, true),
        ],
        data,
    };

    invoke_signed(
        &ix,
        &[source, mint, destination, authority, program_signer, token_program],
        signer_seeds,
    )
    .map_err(Into::into)
}
