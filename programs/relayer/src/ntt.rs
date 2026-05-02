use anchor_lang::prelude::*;

use crate::constants::{NTT_PROGRAM_ID, NTT_SESSION_AUTHORITY_SEED};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy)]
pub struct NttTransferArgs {
    pub amount: u64,
    pub recipient_chain: u16,
    pub recipient_address: [u8; 32],
    pub should_queue: bool,
}

const NTT_TRANSFER_ARGS_PACKED_SIZE: usize = 8 + 2 + 32 + 1;

impl NttTransferArgs {
    fn pack_be(&self) -> [u8; NTT_TRANSFER_ARGS_PACKED_SIZE] {
        let mut buf = [0u8; NTT_TRANSFER_ARGS_PACKED_SIZE];
        buf[0..8].copy_from_slice(&self.amount.to_be_bytes());
        buf[8..10].copy_from_slice(&self.recipient_chain.to_be_bytes());
        buf[10..42].copy_from_slice(&self.recipient_address);
        buf[42] = u8::from(self.should_queue);
        buf
    }

    pub fn args_hash(&self) -> [u8; 32] {
        solana_keccak_hasher::hash(&self.pack_be()).to_bytes()
    }
}

pub fn derive_session_authority(sender: &Pubkey, args: &NttTransferArgs) -> (Pubkey, u8) {
    let hash = args.args_hash();
    Pubkey::find_program_address(
        &[NTT_SESSION_AUTHORITY_SEED, sender.as_ref(), hash.as_ref()],
        &NTT_PROGRAM_ID,
    )
}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct NttRedeemArgs {}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct NttReleaseInboundArgs {
    pub revert_on_delay: bool,
}

pub const VALIDATED_TRANSCEIVER_MESSAGE_DISC: [u8; 8] =
    [0x61, 0x00, 0x70, 0x7D, 0x6B, 0xDC, 0x25, 0xB5];

/// Offset of `NttManagerMessage.sender` (originating FOGO user wallet) in
/// `ValidatedTransceiverMessage<NativeTokenTransfer<_>>`.
pub const TRANSCEIVER_MESSAGE_SENDER_OFFSET: usize = 106;
