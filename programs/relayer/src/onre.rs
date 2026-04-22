//! OnRe CPI argument layouts and shared swap execution.
//!
//! Both deposit-leg (`swap_usdc_to_onyc`) and withdrawal-leg
//! (`swap_onyc_to_usdc`) instructions call OnRe's
//! `take_offer_permissionless` with identical args shape; only the offer
//! PDA supplied in `remaining_accounts` differs. This module centralises
//! the wire format (`OnreTakeOfferArgs`) and the shared swap execution
//! body (`execute_onre_swap`) so both handlers become trivial
//! delegations.

use anchor_lang::prelude::*;
use anchor_spl::token_interface::TokenAccount;

use crate::constants::{ONRE_PROGRAM_ID, ONRE_TAKE_OFFER_IX};
use crate::cpi::invoke_relayer_signed;
use crate::error::RelayerError;
use crate::state::{Flow, FlowStatus, RelayerConfig};

/// OnRe `take_offer_permissionless` args layout.
///
/// The deployed OnRe program expects `(amount: u64, approval_message:
/// Option<ApprovalMessage>)`. The relayer always passes `None` for the
/// approval message because the offers it targets are permissionless.
#[derive(AnchorSerialize)]
pub struct OnreTakeOfferArgs {
    pub amount: u64,
    /// `None` — no approval message required for permissionless offers.
    pub approval_message: Option<Vec<u8>>,
}

/// Execute a `take_offer_permissionless` CPI and mutate `flow` with the
/// result.
///
/// Preconditions:
///   - `flow.status == Claimed`
///   - `flow.amount > 0`
///
/// Postconditions on success:
///   - `flow.amount` = tokens actually received into `destination_ata`
///     (post-CPI delta, not the input amount — OnRe may return a different
///     amount than requested if the offer has been partially consumed).
///   - `flow.status = Swapped`.
///
/// `remaining_accounts` must contain OnRe's full account list for the
/// target offer in the order OnRe expects, including the relayer authority
/// PDA so the CPI helper can force its signer flag.
pub fn execute_onre_swap<'info>(
    flow: &mut Account<'info, Flow>,
    destination_ata: &mut InterfaceAccount<'info, TokenAccount>,
    relayer_authority: &AccountInfo<'info>,
    relayer_config: &Account<'info, RelayerConfig>,
    remaining_accounts: &[AccountInfo<'info>],
) -> Result<()> {
    require!(
        flow.status == FlowStatus::Claimed,
        RelayerError::FlowStatusMismatch
    );
    require!(flow.amount > 0, RelayerError::ZeroAmountFlow);

    let pre_balance = destination_ata.amount;

    invoke_relayer_signed(
        ONRE_PROGRAM_ID,
        &ONRE_TAKE_OFFER_IX,
        &OnreTakeOfferArgs {
            amount: flow.amount,
            approval_message: None,
        },
        remaining_accounts,
        relayer_authority,
        relayer_config.relayer_authority_bump,
    )?;

    destination_ata.reload()?;
    let received = destination_ata
        .amount
        .checked_sub(pre_balance)
        .ok_or(RelayerError::BalanceUnderflow)?;
    require!(received > 0, RelayerError::ZeroAmountFlow);

    flow.amount = received;
    flow.status = FlowStatus::Swapped;
    Ok(())
}
