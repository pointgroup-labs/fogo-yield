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
    invoke_relayer_signed_with_extra(
        program_id,
        discriminator,
        args,
        remaining_accounts,
        authority,
        authority_bump,
        None,
    )
}

/// One additional PDA co-signer (redeemer or sender) alongside the relayer
/// authority. `seed` must be a single static byte string — both real
/// callers use a one-element seed list (`REDEEMER_SEED` or `SENDER_SEED`).
/// One additional PDA co-signer alongside the relayer authority.
/// `seed` must be a single static byte string.
pub struct ExtraSigner<'a> {
    pub key: Pubkey,
    pub seed: &'a [u8],
    pub bump: u8,
}

/// Like `invoke_relayer_signed`, but additionally signs as one extra PDA
/// (TB redeemer for `claim_usdc`, TB sender for `send_usdc_to_user`).
#[allow(clippy::too_many_arguments)]
pub fn invoke_relayer_signed_with_extra<'info, A: AnchorSerialize>(
    program_id: Pubkey,
    discriminator: &[u8],
    args: &A,
    remaining_accounts: &[AccountInfo<'info>],
    authority: &AccountInfo<'info>,
    authority_bump: u8,
    extra: Option<ExtraSigner<'_>>,
) -> Result<()> {
    let extra_key = extra.as_ref().map(|e| e.key);
    let (metas, data) =
        build_ix_metas_and_data(discriminator, args, remaining_accounts, authority.key, extra_key)?;

    let auth_bump_arr = [authority_bump];
    let auth_seeds: &[&[u8]] = &[RELAYER_SEED, &auth_bump_arr];

    let ix = Instruction {
        program_id,
        accounts: metas,
        data,
    };

    match extra {
        Some(ExtraSigner { seed, bump, .. }) => {
            let extra_bump_arr = [bump];
            let extra_seeds: &[&[u8]] = &[seed, &extra_bump_arr];
            invoke_signed(&ix, remaining_accounts, &[auth_seeds, extra_seeds])?;
        }
        None => {
            invoke_signed(&ix, remaining_accounts, &[auth_seeds])?;
        }
    }
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
    redeemer_key: Option<Pubkey>,
) -> Result<(Vec<AccountMeta>, Vec<u8>)> {
    let mut authority_seen = false;
    let mut redeemer_seen = false;
    let mut metas: Vec<AccountMeta> = Vec::with_capacity(remaining_accounts.len());

    for a in remaining_accounts {
        let is_authority = a.key == authority_key;
        let is_redeemer = redeemer_key.is_some_and(|k| *a.key == k);
        authority_seen |= is_authority;
        redeemer_seen |= is_redeemer;
        metas.push(AccountMeta {
            pubkey: *a.key,
            is_signer: a.is_signer || is_authority || is_redeemer,
            is_writable: a.is_writable,
        });
    }

    require!(authority_seen, RelayerError::AuthorityNotInAccounts);
    if redeemer_key.is_some() {
        require!(redeemer_seen, RelayerError::AuthorityNotInAccounts);
    }

    let mut data = Vec::with_capacity(discriminator.len() + 64);
    data.extend_from_slice(discriminator);
    args.serialize(&mut data)?;

    Ok((metas, data))
}
