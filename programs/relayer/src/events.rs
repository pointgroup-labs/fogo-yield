use anchor_lang::prelude::*;

/// Emitted when USDC is claimed from Wormhole Gateway.
#[event]
pub struct UsdcClaimed {
    pub gateway_claim: Pubkey,
    pub fogo_sender: [u8; 32],
    pub flow: Pubkey,
    pub amount: u64,
}

/// Emitted when ONyc is locked via NTT and sent back to FOGO.
#[event]
pub struct OnycLocked {
    pub gateway_claim: Pubkey,
    pub fogo_sender: [u8; 32],
    pub amount: u64,
}

/// Emitted when ONyc is unlocked from NTT.
#[event]
pub struct OnycUnlocked {
    pub ntt_inbox_item: Pubkey,
    pub fogo_sender: [u8; 32],
    pub flow: Pubkey,
    pub amount: u64,
}

/// Emitted when USDC is sent back to a FOGO user.
#[event]
pub struct UsdcSentToUser {
    pub ntt_inbox_item: Pubkey,
    pub fogo_sender: [u8; 32],
    pub amount: u64,
}
