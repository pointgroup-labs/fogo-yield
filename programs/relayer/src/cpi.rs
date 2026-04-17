//! Raw CPI helper.
//!
//! The relayer calls three external programs (Wormhole Gateway, OnRe, Wormhole
//! NTT) whose Rust client crates are either unstable or unpublished. To avoid
//! pulling in volatile upstream dependencies — and to keep the "stolen key =
//! zero theft" property absolute — every external CPI goes through a single
//! helper that enforces two invariants:
//!
//! 1. The destination program ID is a compile-time constant (see `constants.rs`).
//! 2. The instruction discriminator is a compile-time constant.
//!
//! A compromised operator key therefore cannot:
//!   - Redirect a CPI to an attacker-controlled program (program ID is pinned).
//!   - Call a different method on the real program (discriminator is pinned).
//!
//! The only thing a operator controls is the *arguments* serialized into the
//! pinned method and the *accounts* forwarded (via `remaining_accounts`).
//! Since both program and method are fixed, the worst case is "operator
//! triggers a legitimate operation at a suboptimal time" — not theft.
//!
//! ## Account forwarding contract
//!
//! Upstream Anchor programs (OnRe, NTT) declare fixed `#[derive(Accounts)]`
//! layouts where each account has a specific *index*. We therefore cannot
//! synthesize writable/signer flags on the relayer side or append accounts
//! at the tail — the upstream program would read the wrong slot.
//!
//! The contract is:
//!   - The caller passes the **complete, correctly-ordered** upstream account
//!     list via `remaining_accounts`, including the relayer authority PDA at
//!     whichever index the upstream program expects it.
//!   - Writability / read-only flags are copied verbatim from the caller's
//!     `AccountInfo` — the caller is responsible for flagging mutability
//!     correctly when building the outer transaction.
//!   - This helper locates the authority PDA by pubkey in the forwarded list
//!     and forces its `is_signer = true` flag so the upstream program sees
//!     a valid PDA signature. If the authority is not present, we error.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
use anchor_lang::solana_program::program::invoke_signed;

use crate::constants::RELAYER_SEED;
use crate::error::RelayerError;

/// Invoke an external program, signed by the relayer authority PDA.
///
/// `discriminator` is copied verbatim to the front of the instruction data;
/// use an 8-byte Anchor sighash for Anchor programs and a 1-byte variant
/// tag for native-Solana-style programs (Wormhole Gateway).
///
/// Instruction data = `discriminator` ++ `Borsh(args)`.
pub fn invoke_relayer_signed<'info, A: AnchorSerialize>(
    program_id: Pubkey,
    discriminator: &[u8],
    args: &A,
    remaining_accounts: &[AccountInfo<'info>],
    authority: &AccountInfo<'info>,
    authority_bump: u8,
) -> Result<()> {
    let authority_key = *authority.key;

    // Build metas from the caller-provided layout. The authority PDA must
    // appear somewhere in `remaining_accounts`; we force its signer flag.
    let mut authority_seen = false;
    let mut metas: Vec<AccountMeta> = Vec::with_capacity(remaining_accounts.len());
    for a in remaining_accounts {
        let is_authority = *a.key == authority_key;
        authority_seen |= is_authority;
        metas.push(AccountMeta {
            pubkey: *a.key,
            is_signer: a.is_signer || is_authority,
            is_writable: a.is_writable,
        });
    }
    require!(authority_seen, RelayerError::AuthorityNotInAccounts);

    let mut data = Vec::with_capacity(discriminator.len() + 64);
    data.extend_from_slice(discriminator);
    args.serialize(&mut data)?;

    let bump = [authority_bump];
    let signer_seeds: &[&[u8]] = &[RELAYER_SEED, &bump];
    invoke_signed(
        &Instruction {
            program_id,
            accounts: metas,
            data,
        },
        remaining_accounts,
        &[signer_seeds],
    )?;
    Ok(())
}
