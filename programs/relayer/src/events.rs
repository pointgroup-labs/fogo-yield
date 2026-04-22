//! Relayer event shapes.
//!
//! Every event carries `flow: Pubkey` as the universal correlation handle
//! between an on-chain emit and the `Flow` PDA it belongs to. Inbound-leg
//! events (`UsdcClaimed`, `OnycUnlocked`) additionally expose the fee
//! decomposition so indexers don't have to re-derive `gross - net` from
//! `deposit_fee_bps` / `withdraw_fee_bps`.

use anchor_lang::prelude::*;

/// Emitted by `claim_usdc` after the Gateway CPI lands USDC in the relayer
/// ATA and the deposit fee is applied.
///
/// `gross_amount` = amount TB actually minted (pre-fee).
/// `fee_amount`   = deposit fee retained by the relayer (gross - net).
/// `net_amount`   = amount recorded on the `Flow` PDA (== value of the
///                  eventual ONyc swap on the next step).
#[event]
pub struct UsdcClaimed {
    pub flow: Pubkey,
    pub gateway_claim: Pubkey,
    pub fogo_sender: [u8; 32],
    pub gross_amount: u64,
    pub fee_amount: u64,
    pub net_amount: u64,
}

/// Emitted by `unlock_onyc` after the NTT redeem + release CPIs land ONyc
/// in the relayer ATA and the withdrawal fee is applied. Fields mirror
/// `UsdcClaimed` — same semantics, opposite direction.
#[event]
pub struct OnycUnlocked {
    pub flow: Pubkey,
    pub ntt_inbox_item: Pubkey,
    pub fogo_sender: [u8; 32],
    pub gross_amount: u64,
    pub fee_amount: u64,
    pub net_amount: u64,
}

/// Emitted by `lock_onyc` after NTT locks the flow's ONyc amount and
/// initiates the bONyc transfer back to FOGO. No fee is applied on the
/// outbound leg (it was already taken on the inbound `claim_usdc`), so
/// `amount` is the single relevant figure.
#[event]
pub struct OnycLocked {
    pub flow: Pubkey,
    pub gateway_claim: Pubkey,
    pub fogo_sender: [u8; 32],
    pub amount: u64,
}

/// Emitted by `send_usdc_to_user` after the Gateway outbound transfer is
/// submitted. No fee applied on this leg (taken at `unlock_onyc`), so
/// `amount` is the single relevant figure.
#[event]
pub struct UsdcSentToUser {
    pub flow: Pubkey,
    pub ntt_inbox_item: Pubkey,
    pub fogo_sender: [u8; 32],
    pub amount: u64,
}
