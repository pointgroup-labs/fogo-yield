//! Raw CPI helper.
//!
//! Every external CPI goes through one helper that pins destination program
//! ID and instruction discriminator at compile time. A compromised operator
//! key cannot redirect a CPI or call a different method — operator-controllable
//! surface reduces to *arguments* and forwarded `remaining_accounts`.
//!
//! Upstream Anchor programs index accounts by position; the caller must pass
//! the complete, correctly-ordered list with the relayer authority PDA at the
//! expected slot. This helper locates the authority by pubkey and forces
//! `is_signer = true`; if absent, errors.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
use anchor_lang::solana_program::program::invoke_signed;
use anchor_spl::token_interface::{transfer_checked, TransferChecked};

use crate::constants::RELAYER_SEED;
use crate::error::RelayerError;

/// Invoke an external program signed by the relayer authority PDA.
pub fn invoke_relayer_signed<'info, A: AnchorSerialize>(
    program_id: Pubkey,
    discriminator: &[u8],
    args: &A,
    remaining_accounts: &[AccountInfo<'info>],
    authority: &AccountInfo<'info>,
    authority_bump: u8,
) -> Result<()> {
    let (metas, data) =
        build_ix_metas_and_data(discriminator, args, remaining_accounts, authority.key)?;

    let auth_bump_arr = [authority_bump];
    let auth_seeds: &[&[u8]] = &[RELAYER_SEED, &auth_bump_arr];

    let ix = Instruction {
        program_id,
        accounts: metas,
        data,
    };
    invoke_signed(&ix, remaining_accounts, &[auth_seeds])?;
    Ok(())
}

/// Invoke an external program with the relayer-authority PDA seeds in the
/// signer set, but **without** asserting that the PDA appears in
/// `remaining_accounts`. Used for upstream CPIs that do not require the
/// relayer authority as a signer (e.g. NTT `release_wormhole_outbound`,
/// where the queued-outbox publish step is permissionless wrt the manager
/// custody owner). The PDA seeds are still passed so `invoke_signed`'s
/// signer-set covers any incidental PDA derivation, but the
/// `authority_seen` defense-in-depth check is intentionally skipped — the
/// upstream account list has no slot for it.
pub fn invoke_relayer_passthrough_signed<'info, A: AnchorSerialize>(
    program_id: Pubkey,
    discriminator: &[u8],
    args: &A,
    remaining_accounts: &[AccountInfo<'info>],
    authority_bump: u8,
) -> Result<()> {
    let mut metas: Vec<AccountMeta> = Vec::with_capacity(remaining_accounts.len());
    for a in remaining_accounts {
        metas.push(AccountMeta {
            pubkey: *a.key,
            is_signer: a.is_signer,
            is_writable: a.is_writable,
        });
    }

    let mut data = Vec::with_capacity(discriminator.len() + 64);
    data.extend_from_slice(discriminator);
    args.serialize(&mut data)?;

    let auth_bump_arr = [authority_bump];
    let auth_seeds: &[&[u8]] = &[RELAYER_SEED, &auth_bump_arr];

    let ix = Instruction {
        program_id,
        accounts: metas,
        data,
    };
    invoke_signed(&ix, remaining_accounts, &[auth_seeds])?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub fn relayer_signed_transfer_checked<'info>(
    token_program: &AccountInfo<'info>,
    from: &AccountInfo<'info>,
    mint: &AccountInfo<'info>,
    to: &AccountInfo<'info>,
    authority: &AccountInfo<'info>,
    authority_bump: u8,
    amount: u64,
    decimals: u8,
) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    let bump_arr = [authority_bump];
    let seeds: &[&[u8]] = &[RELAYER_SEED, &bump_arr];
    transfer_checked(
        CpiContext::new_with_signer(
            *token_program.key,
            TransferChecked {
                from: from.clone(),
                mint: mint.clone(),
                to: to.clone(),
                authority: authority.clone(),
            },
            &[seeds],
        ),
        amount,
        decimals,
    )
}

fn build_ix_metas_and_data<'info, A: AnchorSerialize>(
    discriminator: &[u8],
    args: &A,
    remaining_accounts: &[AccountInfo<'info>],
    authority_key: &Pubkey,
) -> Result<(Vec<AccountMeta>, Vec<u8>)> {
    let mut authority_seen = false;
    let mut metas: Vec<AccountMeta> = Vec::with_capacity(remaining_accounts.len());

    for a in remaining_accounts {
        let is_authority = a.key == authority_key;
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

    Ok((metas, data))
}
