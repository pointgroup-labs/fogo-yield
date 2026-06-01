//! Deterministic, hermetic test router for the relayer `swap` handler.
//!
//! NOT a real AMM — it moves exact, caller-specified amounts between the
//! relayer ATAs and its own pool token accounts so the withdraw-swap e2e
//! (and the 3.6 malicious-router negatives) run without Jupiter or any
//! mainnet route fixtures.
//!
//! Instruction data: `[mode: u8][in_amount: u64 LE][out_amount: u64 LE]`.
//!
//! Account order (the test supplies these as `swapAccounts`):
//!   0 asset_ata        (w)  relayer ONyc ATA — pulled FROM
//!   1 base_ata         (w)  relayer USDC ATA — pushed TO
//!   2 pool_asset       (w)  router ONyc pool — receives the pull
//!   3 pool_base        (w)  router USDC pool — funds the push
//!   4 relayer_authority (signer) pull authority (PDA-signed by the handler)
//!   5 pool_authority   (PDA)  push authority, seeds [b"pool_auth"]
//!   6 token_program
//!   7 system_program   (mode 3 only)
//!
//! Modes: 0 HONEST, 1 TAMPER_DELEGATE, 2 TAMPER_CLOSE, 3 DRAIN_LAMPORTS.
//! Only mode 0 is exercised here; 1–3 exist for the 3.6 negative tests.
//!
//! Rebuild: see Cargo.toml header.

use solana_program::account_info::{next_account_info, AccountInfo};
use solana_program::entrypoint;
use solana_program::entrypoint::ProgramResult;
use solana_program::instruction::{AccountMeta, Instruction};
use solana_program::program::{invoke, invoke_signed};
use solana_program::program_error::ProgramError;
use solana_program::pubkey::Pubkey;
use solana_program::system_instruction;

const POOL_AUTH_SEED: &[u8] = b"pool_auth";

entrypoint!(process_instruction);

fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    if data.len() < 17 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let mode = data[0];
    let in_amount = u64::from_le_bytes(data[1..9].try_into().unwrap());
    let out_amount = u64::from_le_bytes(data[9..17].try_into().unwrap());

    let it = &mut accounts.iter();
    let asset_ata = next_account_info(it)?;
    let base_ata = next_account_info(it)?;
    let pool_asset = next_account_info(it)?;
    let pool_base = next_account_info(it)?;
    let relayer_authority = next_account_info(it)?;
    let pool_authority = next_account_info(it)?;
    let token_program = next_account_info(it)?;

    let (expected_pool_auth, pool_bump) =
        Pubkey::find_program_address(&[POOL_AUTH_SEED], program_id);
    if expected_pool_auth != *pool_authority.key {
        return Err(ProgramError::InvalidSeeds);
    }

    // Pull ONyc from the relayer ATA; relayer_authority's signer privilege
    // propagates from the handler's invoke_signed, so a plain invoke suffices.
    invoke(
        &spl_transfer(token_program.key, asset_ata.key, pool_asset.key, relayer_authority.key, in_amount),
        &[asset_ata.clone(), pool_asset.clone(), relayer_authority.clone(), token_program.clone()],
    )?;

    // Push USDC from the router pool, signed by the pool-authority PDA.
    invoke_signed(
        &spl_transfer(token_program.key, pool_base.key, base_ata.key, pool_authority.key, out_amount),
        &[pool_base.clone(), base_ata.clone(), pool_authority.clone(), token_program.clone()],
        &[&[POOL_AUTH_SEED, &[pool_bump]]],
    )?;

    match mode {
        1 => invoke(
            &spl_approve(token_program.key, asset_ata.key, pool_authority.key, relayer_authority.key, 1),
            &[asset_ata.clone(), pool_authority.clone(), relayer_authority.clone(), token_program.clone()],
        )?,
        2 => invoke(
            &spl_set_close_authority(token_program.key, asset_ata.key, relayer_authority.key, pool_authority.key),
            &[asset_ata.clone(), relayer_authority.clone(), token_program.clone()],
        )?,
        3 => {
            let system_program = next_account_info(it)?;
            invoke(
                &system_instruction::transfer(relayer_authority.key, pool_authority.key, in_amount),
                &[relayer_authority.clone(), pool_authority.clone(), system_program.clone()],
            )?;
        }
        _ => {}
    }

    Ok(())
}

fn spl_transfer(token_program: &Pubkey, source: &Pubkey, dest: &Pubkey, authority: &Pubkey, amount: u64) -> Instruction {
    let mut data = Vec::with_capacity(9);
    data.push(3u8);
    data.extend_from_slice(&amount.to_le_bytes());
    Instruction {
        program_id: *token_program,
        accounts: vec![
            AccountMeta::new(*source, false),
            AccountMeta::new(*dest, false),
            AccountMeta::new_readonly(*authority, true),
        ],
        data,
    }
}

fn spl_approve(token_program: &Pubkey, source: &Pubkey, delegate: &Pubkey, owner: &Pubkey, amount: u64) -> Instruction {
    let mut data = Vec::with_capacity(9);
    data.push(4u8);
    data.extend_from_slice(&amount.to_le_bytes());
    Instruction {
        program_id: *token_program,
        accounts: vec![
            AccountMeta::new(*source, false),
            AccountMeta::new_readonly(*delegate, false),
            AccountMeta::new_readonly(*owner, true),
        ],
        data,
    }
}

fn spl_set_close_authority(token_program: &Pubkey, account: &Pubkey, current_authority: &Pubkey, new_authority: &Pubkey) -> Instruction {
    let mut data = Vec::with_capacity(35);
    data.push(6u8);
    data.push(3u8); // AuthorityType::CloseAccount
    data.push(1u8); // COption::Some
    data.extend_from_slice(new_authority.as_ref());
    Instruction {
        program_id: *token_program,
        accounts: vec![
            AccountMeta::new(*account, false),
            AccountMeta::new_readonly(*current_authority, true),
        ],
        data,
    }
}
