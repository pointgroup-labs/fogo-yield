use anchor_lang::prelude::*;

use crate::constants::NTT_SESSION_AUTHORITY_SEED;

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

pub fn derive_session_authority(
    program_id: &Pubkey,
    sender: &Pubkey,
    args: &NttTransferArgs,
) -> (Pubkey, u8) {
    let hash = args.args_hash();
    Pubkey::find_program_address(
        &[NTT_SESSION_AUTHORITY_SEED, sender.as_ref(), hash.as_ref()],
        program_id,
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

const NTT_MANAGER_PEER_SEED: &[u8] = b"peer";
const NTT_INBOX_RATE_LIMIT_SEED: &[u8] = b"inbox_rate_limit";

/// Derive the NTT manager's `peer` PDA for a given Wormhole chain id.
/// The relayer pins this against `FOGO_WORMHOLE_CHAIN_ID` to refuse
/// inbound NTT messages whose origin chain isn't FOGO — without this
/// check, a future non-FOGO peer registration on the NTT manager would
/// let foreign-chain VAAs create Flow PDAs that the relayer would then
/// blindly bridge back to FOGO.
pub fn derive_ntt_peer(program_id: &Pubkey, chain_id: u16) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[NTT_MANAGER_PEER_SEED, &chain_id.to_be_bytes()],
        program_id,
    )
}

/// Derive the NTT manager's per-chain `inbox_rate_limit` PDA. Same
/// chain-pinning rationale as `derive_ntt_peer`.
pub fn derive_ntt_inbox_rate_limit(program_id: &Pubkey, chain_id: u16) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[NTT_INBOX_RATE_LIMIT_SEED, &chain_id.to_be_bytes()],
        program_id,
    )
}
