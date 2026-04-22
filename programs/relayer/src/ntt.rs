//! Wormhole NTT helpers.
//!
//! Centralises the NTT outbound-transfer wire format so the layout (field
//! order, big-endian amounts, keccak hash domain) lives next to the struct
//! that defines it instead of being open-coded in handler scratch buffers.

use anchor_lang::prelude::*;

use crate::constants::{NTT_PROGRAM_ID, NTT_SESSION_AUTHORITY_SEED};

/// Wormhole NTT `transfer_lock` / `transfer_burn` arguments.
///
/// Identical Borsh layout for both Locking and Burning modes — only the
/// instruction discriminator differs (see `NTT_TRANSFER_LOCK_IX`).
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy)]
pub struct NttTransferArgs {
    pub amount: u64,
    pub recipient_chain: u16,
    pub recipient_address: [u8; 32],
    pub should_queue: bool,
}

// Wire size of `NttTransferArgs` when packed in big-endian for the
// session-authority hash domain: u64 + u16 + [u8;32] + bool = 43 bytes.
const NTT_TRANSFER_ARGS_PACKED_SIZE: usize = 8 + 2 + 32 + 1;

impl NttTransferArgs {
    /// Serialise into NTT's big-endian packed form, used as the keccak
    /// pre-image for the session-authority PDA.
    fn pack_be(&self) -> [u8; NTT_TRANSFER_ARGS_PACKED_SIZE] {
        let mut buf = [0u8; NTT_TRANSFER_ARGS_PACKED_SIZE];
        buf[0..8].copy_from_slice(&self.amount.to_be_bytes());
        buf[8..10].copy_from_slice(&self.recipient_chain.to_be_bytes());
        buf[10..42].copy_from_slice(&self.recipient_address);
        buf[42] = u8::from(self.should_queue);
        buf
    }

    /// keccak256(amount_be || chain_be || recipient || should_queue).
    /// This is the same digest NTT uses to bind a session-authority PDA
    /// to a specific transfer's arguments.
    pub fn args_hash(&self) -> [u8; 32] {
        solana_keccak_hasher::hash(&self.pack_be()).to_bytes()
    }
}

/// Derive NTT's session-authority PDA for a given (sender, transfer args).
///
/// Returns `(session_authority, bump)`.
pub fn derive_session_authority(sender: &Pubkey, args: &NttTransferArgs) -> (Pubkey, u8) {
    let hash = args.args_hash();
    Pubkey::find_program_address(
        &[
            NTT_SESSION_AUTHORITY_SEED,
            sender.as_ref(),
            hash.as_ref(),
        ],
        &NTT_PROGRAM_ID,
    )
}

// ── Inbound NTT instruction args ───────────────────────────────────────

/// NTT `redeem` args — a unit struct. `redeem` reads everything it needs
/// from the already-validated `ValidatedTransceiverMessage` account
/// (written earlier by the wormhole transceiver's `receive_message`).
#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct NttRedeemArgs {}

/// NTT `release_inbound_unlock` args. `revert_on_delay = false` lets the
/// CPI succeed even when the release is delayed by NTT's rate limiter.
#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct NttReleaseInboundArgs {
    pub revert_on_delay: bool,
}

// ── Anchor-account introspection for `ValidatedTransceiverMessage` ─────

/// Anchor discriminator for `ValidatedTransceiverMessage` —
/// `sha256("account:ValidatedTransceiverMessage")[..8]`. Upstream NTT
/// type at
/// `solana/programs/example-native-token-transfers/src/messages.rs`.
pub const VALIDATED_TRANSCEIVER_MESSAGE_DISC: [u8; 8] =
    [0x61, 0x00, 0x70, 0x7D, 0x6B, 0xDC, 0x25, 0xB5];

/// Byte offset of `NttManagerMessage.sender` inside the Anchor-Borsh
/// layout of `ValidatedTransceiverMessage<NativeTokenTransfer<_>>`:
///   disc(8) + from_chain(2) + source_ntt_manager(32)
///   + recipient_ntt_manager(32) + NttManagerMessage.id(32) = 106.
/// The next 32 bytes are `NttManagerMessage.sender` — the originating
/// FOGO user wallet passed through NTT on the source chain.
pub const TRANSCEIVER_MESSAGE_SENDER_OFFSET: usize = 106;
