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

/// Args for NTT v3 `release_wormhole_outbound`. Same single-bool shape as
/// `NttReleaseInboundArgs`, mirrored separately so an upstream rename of
/// either field doesn't silently bleed across CPI sites.
#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct NttReleaseOutboundArgs {
    pub revert_on_delay: bool,
}

pub const VALIDATED_TRANSCEIVER_MESSAGE_DISC: [u8; 8] =
    [0x61, 0x00, 0x70, 0x7D, 0x6B, 0xDC, 0x25, 0xB5];

/// On-disk byte layout of `ValidatedTransceiverMessage<NativeTokenTransfer<EmptyPayload>>`
/// (Borsh; total 213 bytes after the 8-byte Anchor disc):
///
/// ```text
///   8..10   from_chain                 u16 LE
///  10..42   source_ntt_manager         [u8; 32]
///  42..74   recipient_ntt_manager      [u8; 32]
///  74..106  NttManagerMessage.id       [u8; 32]
/// 106..138  NttManagerMessage.sender   [u8; 32]
/// 138..146  trimmed_amount             u64 LE
/// 146..147  trimmed_decimals           u8
/// 147..179  source_token               [u8; 32]
/// 179..181  to_chain                   u16 LE
/// 181..213  to                         [u8; 32]
/// ```
pub const TRANSCEIVER_MESSAGE_FROM_CHAIN_OFFSET: usize = 8;
pub const TRANSCEIVER_MESSAGE_ID_OFFSET: usize = 74;
pub const TRANSCEIVER_MESSAGE_SENDER_OFFSET: usize = 106;
pub const TRANSCEIVER_MESSAGE_TRIMMED_AMOUNT_OFFSET: usize = 138;
pub const TRANSCEIVER_MESSAGE_TRIMMED_DECIMALS_OFFSET: usize = 146;
pub const TRANSCEIVER_MESSAGE_SOURCE_TOKEN_OFFSET: usize = 147;
pub const TRANSCEIVER_MESSAGE_TO_CHAIN_OFFSET: usize = 179;
pub const TRANSCEIVER_MESSAGE_TO_OFFSET: usize = 181;
pub const TRANSCEIVER_MESSAGE_TOTAL_LEN: usize = 213;

const INBOX_ITEM_SEED: &[u8] = b"inbox_item";

/// Wire prefix for `NativeTokenTransfer` (`0x99 N T T`). Pinned upstream;
/// keccak input below depends on it.
const NTT_WIRE_PREFIX: [u8; 4] = [0x99, b'N', b'T', b'T'];

/// Re-derive the `InboxItem` PDA from the on-disk
/// `ValidatedTransceiverMessage` bytes, matching the seed and hash NTT
/// itself uses inside `redeem`:
///
/// ```text
///   pda = find_program_address(
///       [b"inbox_item", keccak256(from_chain_BE || NttManagerMessage_wire_bytes)],
///       ntt_manager_program_id,
///   )
/// ```
///
/// The wire encoding differs from the on-disk Borsh layout: integers are
/// big-endian, `NttManagerMessage` includes a `payload_len: u16 BE`
/// field, and `NativeTokenTransfer` carries a `0x99 N T T` prefix. We
/// transcode here so the on-chain check matches whatever NTT redeem
/// would have computed had it been called.
///
/// **Why this is security-critical on the `claim_usdc` skip path:**
/// when `inbox_item.release_status == Released`, the NTT redeem CPI is
/// bypassed entirely; without this re-derivation the relayer has no
/// proof that the supplied `ntt_transceiver_message` is the message
/// that produced the supplied `ntt_inbox_item`. A cranker could
/// otherwise pair any setter-originated VTM with an attacker-controlled
/// InboxItem (e.g. one created by a *direct* NTT bridge to a per-user
/// PDA, bypassing intent_transfer's fee path on FOGO) and the skip
/// path would happily sweep the funds and mint a `Flow` for them.
///
/// Returns `InvalidTransceiverMessage` if the data is too short.
pub fn derive_inbox_item_pda_from_vtm(
    program_id: &Pubkey,
    vtm_data: &[u8],
) -> Result<(Pubkey, u8)> {
    require!(
        vtm_data.len() >= TRANSCEIVER_MESSAGE_TOTAL_LEN,
        crate::error::RelayerError::InvalidTransceiverMessage
    );

    let from_chain_le = u16::from_le_bytes([
        vtm_data[TRANSCEIVER_MESSAGE_FROM_CHAIN_OFFSET],
        vtm_data[TRANSCEIVER_MESSAGE_FROM_CHAIN_OFFSET + 1],
    ]);
    let from_chain_be = from_chain_le.to_be_bytes();

    let id = &vtm_data[TRANSCEIVER_MESSAGE_ID_OFFSET..TRANSCEIVER_MESSAGE_ID_OFFSET + 32];
    let sender = &vtm_data[TRANSCEIVER_MESSAGE_SENDER_OFFSET..TRANSCEIVER_MESSAGE_SENDER_OFFSET + 32];

    let trimmed_amount_le = u64::from_le_bytes(
        vtm_data[TRANSCEIVER_MESSAGE_TRIMMED_AMOUNT_OFFSET
            ..TRANSCEIVER_MESSAGE_TRIMMED_AMOUNT_OFFSET + 8]
            .try_into()
            .unwrap(),
    );
    let trimmed_amount_be = trimmed_amount_le.to_be_bytes();
    let trimmed_decimals = vtm_data[TRANSCEIVER_MESSAGE_TRIMMED_DECIMALS_OFFSET];

    let source_token =
        &vtm_data[TRANSCEIVER_MESSAGE_SOURCE_TOKEN_OFFSET..TRANSCEIVER_MESSAGE_SOURCE_TOKEN_OFFSET + 32];

    let to_chain_le = u16::from_le_bytes([
        vtm_data[TRANSCEIVER_MESSAGE_TO_CHAIN_OFFSET],
        vtm_data[TRANSCEIVER_MESSAGE_TO_CHAIN_OFFSET + 1],
    ]);
    let to_chain_be = to_chain_le.to_be_bytes();

    let to = &vtm_data[TRANSCEIVER_MESSAGE_TO_OFFSET..TRANSCEIVER_MESSAGE_TO_OFFSET + 32];

    // NativeTokenTransfer wire body (79 bytes for EmptyPayload):
    // prefix(4) + decimals(1) + amount_BE(8) + source_token(32) + to(32) + to_chain_BE(2)
    let mut ntt_wire = [0u8; 4 + 1 + 8 + 32 + 32 + 2];
    ntt_wire[0..4].copy_from_slice(&NTT_WIRE_PREFIX);
    ntt_wire[4] = trimmed_decimals;
    ntt_wire[5..13].copy_from_slice(&trimmed_amount_be);
    ntt_wire[13..45].copy_from_slice(source_token);
    ntt_wire[45..77].copy_from_slice(to);
    ntt_wire[77..79].copy_from_slice(&to_chain_be);

    // NttManagerMessage wire body (145 bytes):
    // id(32) + sender(32) + payload_len_BE(2) + ntt_wire(79)
    let payload_len_be = (ntt_wire.len() as u16).to_be_bytes();
    let mut msg_wire = [0u8; 32 + 32 + 2 + 79];
    msg_wire[0..32].copy_from_slice(id);
    msg_wire[32..64].copy_from_slice(sender);
    msg_wire[64..66].copy_from_slice(&payload_len_be);
    msg_wire[66..145].copy_from_slice(&ntt_wire);

    // keccak input: from_chain_BE(2) || msg_wire(145)
    let mut hash_input = [0u8; 2 + 145];
    hash_input[0..2].copy_from_slice(&from_chain_be);
    hash_input[2..147].copy_from_slice(&msg_wire);
    let digest = solana_keccak_hasher::hash(&hash_input).to_bytes();

    Ok(Pubkey::find_program_address(
        &[INBOX_ITEM_SEED, &digest],
        program_id,
    ))
}

/// Anchor account discriminator for NTT v1 `InboxItem`. Empirically
/// captured from `nttu74Cd…ZSdGk.so`'s post-redeem account write — do
/// NOT trust upstream source comments to derive this; the
/// `sha256("account:InboxItem")[..8]` formula matched neither prior
/// guess.
pub const INBOX_ITEM_DISC: [u8; 8] = [0xED, 0x8D, 0xCC, 0x67, 0xBB, 0x7A, 0x39, 0x5C];

/// Vendored mirror of NTT v1's `InboxItem` account body (mirrored from
/// upstream `example-native-token-transfers/solana/programs/example-native-token-transfers/src/queue/inbox.rs`).
///
/// We deserialize via plain borsh + a manual discriminator strip
/// instead of `#[account]`, because Anchor's `#[account]` derive would
/// generate `sha256("account:InboxItem")[..8]` as the discriminator —
/// which empirically does NOT match the bytes upstream actually
/// writes. Holding both the discriminator AND the layout in one place
/// keeps drift detection localized: if upstream ever changes either,
/// the borsh deserialize fails (catching layout drift) or the disc
/// check fails (catching discriminator drift), and the sha256 binary
/// pin in `pinBinaryFixtures()` confirms which.
///
/// Total on-disk space (informational, not enforced here): 8 (disc) +
/// 1 + 1 + 8 + 32 + 16 + 9 (max-variant enum slot) = 75 bytes. Borsh
/// silently ignores trailing bytes after the active enum variant, so
/// reading `Released` (no payload) leaves 8 trailing bytes untouched.
#[derive(AnchorDeserialize, AnchorSerialize, Clone)]
pub struct InboxItem {
    pub init: bool,
    pub bump: u8,
    pub amount: u64,
    pub recipient_address: Pubkey,
    /// `Bitmap` upstream wraps a `u128`. We mirror as the inner type
    /// since we only need to skip past it during deserialization.
    pub votes: u128,
    pub release_status: ReleaseStatus,
}

#[derive(AnchorDeserialize, AnchorSerialize, Clone, PartialEq, Eq)]
pub enum ReleaseStatus {
    NotApproved,
    ReleaseAfterDelay(u64),
    Released,
}

impl InboxItem {
    /// Strip the 8-byte discriminator (asserting it matches upstream)
    /// and borsh-deserialize the remainder. Uses the non-strict
    /// reader-cursor API (`deserialize`, not `try_from_slice`) because
    /// upstream's `release_status` field reserves 9 bytes on disk
    /// (max-variant size for `ReleaseAfterDelay(u64)`), but the
    /// `Released` variant consumes only 1 — the strict variant would
    /// reject every released InboxItem with `NotAllBytesRead`. Returns
    /// `RelayerError::InvalidInboxItem` for any failure mode (account
    /// too short, wrong discriminator, malformed body) so callers can
    /// distinguish "fresh, run the CPIs" from "fatal, abort" via
    /// `try_load(...).ok()`.
    pub fn try_load(account: &AccountInfo) -> Result<Self> {
        let data = account.try_borrow_data()?;
        require!(
            data.len() >= 8 && data[..8] == INBOX_ITEM_DISC,
            crate::error::RelayerError::InvalidInboxItem
        );
        let mut cursor: &[u8] = &data[8..];
        Self::deserialize(&mut cursor)
            .map_err(|_| crate::error::RelayerError::InvalidInboxItem.into())
    }
}

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
