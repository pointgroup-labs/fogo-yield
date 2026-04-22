use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::constants::{CONFIG_SEED, RELAYER_SEED};
use crate::error::RelayerError;
use crate::state::RelayerConfig;

/// Update admin-mutable relayer configuration. All inputs are optional:
///
/// - `deposit_fee_bps` / `withdraw_fee_bps`: pass `None` to leave unchanged.
/// - `fee_vault` account: pass `None` to leave the stored vault unchanged
///   (and skip the four supporting validation accounts entirely). When
///   `Some`, the mint + antialiasing constraints re-run on the new
///   vault and the new pubkey is written into config.
/// - `new_authority`: two-step authority rotation. Semantics:
///     - `None` — leave `pending_authority` unchanged
///     - `Some(default())` — clear any in-flight proposal (cancel)
///     - `Some(other)` — propose `other` as the next authority (writes
///       to `pending_authority`; the current `authority` is unchanged
///       until `accept_authority` is called by the proposed key).
///
///   A typo in the proposed pubkey is harmless: until acceptance, the
///   current authority retains full control and can overwrite or
///   cancel the proposal.
///
/// Authority-only.
pub fn handler(
    ctx: Context<Configure>,
    deposit_fee_bps: Option<u16>,
    withdraw_fee_bps: Option<u16>,
    new_authority: Option<Pubkey>,
) -> Result<()> {
    let config = &mut ctx.accounts.relayer_config;

    if let Some(bps) = deposit_fee_bps {
        config.deposit_fee_bps = bps;
    }
    if let Some(bps) = withdraw_fee_bps {
        config.withdraw_fee_bps = bps;
    }
    if let Some(vault) = &ctx.accounts.fee_vault {
        require_keys_neq!(
            vault.key(),
            ctx.accounts.onyc_ata.key(),
            RelayerError::FeeVaultAliasesUserAta
        );
        config.fee_vault = vault.key();
    }
    if let Some(proposed) = new_authority {
        config.pending_authority = if proposed == Pubkey::default() {
            None
        } else {
            Some(proposed)
        };
    }
    config.validate()?;

    msg!(
        "Relayer reconfigured. deposit_fee_bps: {}, withdraw_fee_bps: {}, fee_vault: {}, authority: {}, pending_authority: {:?}.",
        config.deposit_fee_bps,
        config.withdraw_fee_bps,
        config.fee_vault,
        config.authority,
        config.pending_authority,
    );

    Ok(())
}

#[derive(Accounts)]
pub struct Configure<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = relayer_config.bump,
        has_one = authority @ RelayerError::UnauthorizedAuthority,
        has_one = onyc_mint,
    )]
    pub relayer_config: Account<'info, RelayerConfig>,

    /// Relayer authority PDA — owns `onyc_ata`. Re-derived here so the
    /// associated-token derivation on `onyc_ata` resolves and the
    /// anti-aliasing constraint can compare a fully-typed ATA pubkey.
    /// CHECK: PDA seeds enforce identity.
    #[account(
        seeds = [RELAYER_SEED],
        bump = relayer_config.relayer_authority_bump,
    )]
    pub relayer_authority: UncheckedAccount<'info>,

    pub onyc_mint: InterfaceAccount<'info, Mint>,

    /// The relayer's operating ONyc ATA — referenced solely to enforce
    /// `fee_vault != onyc_ata`. Not mutated.
    #[account(
        associated_token::mint = onyc_mint,
        associated_token::authority = relayer_authority,
        associated_token::token_program = token_program,
    )]
    pub onyc_ata: InterfaceAccount<'info, TokenAccount>,

    /// New fee vault destination. `None` to leave the stored vault
    /// unchanged. When `Some`, must hold ONyc; the anti-aliasing check
    /// (`fee_vault != onyc_ata`) runs in the handler since Anchor's
    /// constraint-attribute expressions can't cleanly disambiguate
    /// `Option::as_ref` against `InterfaceAccount`'s `AsRef` impls.
    #[account(
        token::mint = onyc_mint,
        token::token_program = token_program,
    )]
    pub fee_vault: Option<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
}
