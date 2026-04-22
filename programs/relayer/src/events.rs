//! Relayer event shapes.
//!
//! Every event carries `flow: Pubkey` as the universal correlation handle
//! between an on-chain emit and the `Flow` PDA it belongs to. The
//! inbound-leg events (`UsdcClaimed`, `OnycUnlocked`) record only the
//! gross bridged amount — fees are taken at the swap step, not the bridge
//! step, so the inbound-leg events have no fee fields. The swap events
//! (`OnycSwapped`, `UsdcSwapped`) expose the gross/fee/net split.

use anchor_lang::prelude::*;

/// Emitted by `claim_usdc` after the Gateway CPI lands USDC in the relayer
/// ATA. No fee logic on this leg — fees are taken at `swap_usdc_to_onyc`.
#[event]
pub struct UsdcClaimed {
    pub flow: Pubkey,
    pub gateway_claim: Pubkey,
    pub fogo_sender: [u8; 32],
    pub amount: u64,
}

/// Emitted by `unlock_onyc` after the NTT redeem + release CPIs land ONyc
/// in the relayer ATA. No fee logic on this leg — fees are taken at
/// `swap_onyc_to_usdc`.
#[event]
pub struct OnycUnlocked {
    pub flow: Pubkey,
    pub ntt_inbox_item: Pubkey,
    pub fogo_sender: [u8; 32],
    pub amount: u64,
}

/// Emitted by `swap_usdc_to_onyc` after the OnRe swap completes and the
/// post-swap deposit fee has been moved to the fee vault.
///
/// `gross_amount` = ONyc received from OnRe (pre-fee).
/// `fee_amount`   = deposit fee retained by the relayer (gross - net).
/// `net_amount`   = ONyc recorded on the `Flow` PDA (== amount the eventual
///                  `lock_onyc` will ship back to FOGO).
#[event]
pub struct OnycSwapped {
    pub flow: Pubkey,
    pub gross_amount: u64,
    pub fee_amount: u64,
    pub net_amount: u64,
}

/// Emitted by `swap_onyc_to_usdc` after the pre-swap fee has been moved
/// to the fee vault and the OnRe swap completes.
///
/// `gross_amount`  = ONyc input to the swap step (pre-fee, == flow.amount
///                   from `unlock_onyc`).
/// `fee_amount`    = withdrawal fee in ONyc (taken pre-swap).
/// `net_amount`    = ONyc actually swapped (gross - fee).
/// `usdc_received` = USDC received from OnRe (recorded on the Flow PDA).
#[event]
pub struct UsdcSwapped {
    pub flow: Pubkey,
    pub gross_amount: u64,
    pub fee_amount: u64,
    pub net_amount: u64,
    pub usdc_received: u64,
}

/// Emitted by `lock_onyc` after NTT locks the flow's ONyc amount and
/// initiates the bONyc transfer back to FOGO.
#[event]
pub struct OnycLocked {
    pub flow: Pubkey,
    pub gateway_claim: Pubkey,
    pub fogo_sender: [u8; 32],
    pub amount: u64,
}

/// Emitted by `send_usdc_to_user` after the Gateway outbound transfer is
/// submitted.
#[event]
pub struct UsdcSentToUser {
    pub flow: Pubkey,
    pub ntt_inbox_item: Pubkey,
    pub fogo_sender: [u8; 32],
    pub amount: u64,
}
