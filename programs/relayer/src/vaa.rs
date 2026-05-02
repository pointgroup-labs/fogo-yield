//! Extracts `fogo_sender` from a Portal TB `TransferWithPayload` message
//! embedded in a Wormhole posted-VAA account. Reads on-chain account data
//! rather than operator-supplied args — otherwise a compromised operator
//! could redirect outbound transfers.

use anchor_lang::prelude::*;

use crate::error::RelayerError;

const POSTED_VAA_PAYLOAD_OFFSET: usize = 95;
const TRANSFER_HEADER_SIZE: usize = 133;
const PAYLOAD_ID_TRANSFER_WITH_PAYLOAD: u8 = 3;

/// Returns `fogo_sender` — the trailing 32 bytes of `additional_payload`,
/// which the FOGO client appends to every TB TransferWithPayload.
pub fn parse_fogo_sender_from_posted_vaa(account_data: &[u8]) -> Result<[u8; 32]> {
    require!(
        account_data.len() >= POSTED_VAA_PAYLOAD_OFFSET,
        RelayerError::VaaPayloadTooShort
    );

    let tag = &account_data[..3];
    require!(tag == b"msg" || tag == b"msu", RelayerError::InvalidVaa);

    let payload_len_bytes: [u8; 4] = account_data[91..95]
        .try_into()
        .map_err(|_| error!(RelayerError::VaaPayloadTooShort))?;
    let payload_len = u32::from_le_bytes(payload_len_bytes) as usize;

    let payload_end = POSTED_VAA_PAYLOAD_OFFSET
        .checked_add(payload_len)
        .ok_or_else(|| error!(RelayerError::VaaPayloadTooShort))?;
    require!(
        account_data.len() >= payload_end,
        RelayerError::VaaPayloadTooShort
    );

    let payload = &account_data[POSTED_VAA_PAYLOAD_OFFSET..payload_end];

    require!(
        payload.len() >= TRANSFER_HEADER_SIZE,
        RelayerError::VaaPayloadTooShort
    );
    require!(
        payload[0] == PAYLOAD_ID_TRANSFER_WITH_PAYLOAD,
        RelayerError::InvalidVaa
    );

    let additional_payload = &payload[TRANSFER_HEADER_SIZE..];
    require!(
        additional_payload.len() >= 32,
        RelayerError::VaaPayloadTooShort
    );

    let mut fogo_sender = [0u8; 32];
    fogo_sender.copy_from_slice(&additional_payload[additional_payload.len() - 32..]);

    require!(fogo_sender != [0u8; 32], RelayerError::ZeroFogoSender);

    Ok(fogo_sender)
}
