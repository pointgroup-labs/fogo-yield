use nom::{
    branch::alt,
    bytes::complete::tag,
    character::complete::line_ending,
    combinator::{eof, map, verify},
    error::{Error, ParseError},
    sequence::delimited,
    AsChar, Compare, Err, IResult, Input, Offset, ParseTo, Parser,
};
use solana_intents::{tag_key_value, SymbolOrMint, Version};

const BRIDGE_MESSAGE_PREFIX: &str = "Fogo Bridge\n";

#[derive(Debug, PartialEq)]
pub enum BridgeMessage {
    Ntt(NttMessage),
}

/// Where the bridged value lands.
///
/// v0.2 signs the destination address itself. v0.3 signs the swap floor instead
/// and the handler derives the address from it, because the address *is* a PDA of
/// `[user_inbox, signer, min_out]` — 44 base58 characters that carry one number
/// the signer already agreed to. Dropping the derived form takes 44 bytes out of
/// a transaction that clears the 1232 B packet cap by 17, which is what a
/// hardware wallet's 20-byte offchain envelope spends.
#[derive(Debug, PartialEq)]
pub enum Recipient {
    /// v0.2: the destination address, verbatim.
    Address(String),
    /// v0.3: the swap floor in destination base units; the address derives from it.
    MinOut(u64),
}

#[derive(Debug, PartialEq)]
pub struct NttMessage {
    pub version: Version,
    pub from_chain_id: String,
    pub symbol_or_mint: SymbolOrMint,
    pub amount: String,
    pub to_chain_id: String,
    pub recipient: Recipient,
    pub fee_amount: String,
    pub fee_symbol_or_mint: SymbolOrMint,
    pub nonce: u64,
}

#[derive(Copy, Clone, PartialEq)]
pub enum WormholeChainId {
    Solana,
    Fogo,
}

/// Mapping from https://wormhole.com/docs/products/reference/chain-ids/
impl From<WormholeChainId> for u16 {
    fn from(chain_id: WormholeChainId) -> u16 {
        match chain_id {
            WormholeChainId::Solana => 1,
            WormholeChainId::Fogo => 51,
        }
    }
}

impl WormholeChainId {
    pub fn decimals_native(self) -> u32 {
        match self {
            WormholeChainId::Solana => 9,
            WormholeChainId::Fogo => 9,
        }
    }

    /// The decimals of the gas price specification (e.g. microlamports)
    pub fn decimals_gas_price(self) -> u32 {
        match self {
            WormholeChainId::Solana => 15,
            WormholeChainId::Fogo => 15,
        }
    }
}

pub fn convert_chain_id_to_wormhole(chain_id: &str) -> Option<WormholeChainId> {
    match chain_id {
        "solana" => Some(WormholeChainId::Solana),
        "fogo" => Some(WormholeChainId::Fogo),
        _ => None,
    }
}

impl TryFrom<Vec<u8>> for BridgeMessage {
    type Error = Err<Error<Vec<u8>>>;

    fn try_from(message: Vec<u8>) -> Result<Self, Self::Error> {
        match message_ntt.parse(message.as_slice()) {
            Ok((_, message)) => Ok(BridgeMessage::Ntt(message)),
            Err(e) => Err(Err::<Error<&[u8]>>::to_owned(e)),
        }
    }
}

fn message_ntt<I, E>(input: I) -> IResult<I, NttMessage, E>
where
    I: Input,
    I: ParseTo<String>,
    I: ParseTo<SymbolOrMint>,
    I: ParseTo<Version>,
    I: ParseTo<u64>,
    I: ParseTo<u16>,
    I: Offset,
    I: for<'a> Compare<&'a str>,
    <I as Input>::Item: AsChar,
    E: ParseError<I>,
{
    // Both shapes are accepted while clients roll over; 0.2 goes away once the
    // last one is on 0.3. The two differ only in the recipient line, so `alt`
    // discriminates on the version it verifies first.
    alt((message_ntt_v2, message_ntt_v3)).parse(input)
}

fn message_ntt_v2<I, E>(input: I) -> IResult<I, NttMessage, E>
where
    I: Input,
    I: ParseTo<String>,
    I: ParseTo<SymbolOrMint>,
    I: ParseTo<Version>,
    I: ParseTo<u64>,
    I: ParseTo<u16>,
    I: Offset,
    I: for<'a> Compare<&'a str>,
    <I as Input>::Item: AsChar,
    E: ParseError<I>,
{
    map(
        delimited(
            (tag(BRIDGE_MESSAGE_PREFIX), line_ending),
            (
                verify(tag_key_value("version"), |version: &Version| {
                    version.major == 0 && version.minor == 2
                }),
                tag_key_value("from_chain_id"),
                tag_key_value("to_chain_id"),
                tag_key_value("token"),
                tag_key_value("amount"),
                tag_key_value("recipient_address"),
                tag_key_value("fee_token"),
                tag_key_value("fee_amount"),
                tag_key_value("nonce"),
            ),
            eof,
        ),
        |(
            version,
            from_chain_id,
            to_chain_id,
            symbol_or_mint,
            amount,
            recipient_address,
            fee_symbol_or_mint,
            fee_amount,
            nonce,
        )| NttMessage {
            version,
            from_chain_id,
            to_chain_id,
            symbol_or_mint,
            amount,
            recipient: Recipient::Address(recipient_address),
            fee_amount,
            fee_symbol_or_mint,
            nonce,
        },
    )
    .parse(input)
}

fn message_ntt_v3<I, E>(input: I) -> IResult<I, NttMessage, E>
where
    I: Input,
    I: ParseTo<String>,
    I: ParseTo<SymbolOrMint>,
    I: ParseTo<Version>,
    I: ParseTo<u64>,
    I: ParseTo<u16>,
    I: Offset,
    I: for<'a> Compare<&'a str>,
    <I as Input>::Item: AsChar,
    E: ParseError<I>,
{
    map(
        delimited(
            (tag(BRIDGE_MESSAGE_PREFIX), line_ending),
            (
                verify(tag_key_value("version"), |version: &Version| {
                    version.major == 0 && version.minor == 3
                }),
                tag_key_value("from_chain_id"),
                tag_key_value("to_chain_id"),
                tag_key_value("token"),
                tag_key_value("amount"),
                // Base units, not a decimal: this number is a PDA seed and has to
                // round-trip exactly. `amount` can be a decimal because the source
                // mint is an account in the same transaction; the floor is
                // denominated in the destination token, whose mint is not.
                tag_key_value("min_out"),
                tag_key_value("fee_token"),
                tag_key_value("fee_amount"),
                tag_key_value("nonce"),
            ),
            eof,
        ),
        |(
            version,
            from_chain_id,
            to_chain_id,
            symbol_or_mint,
            amount,
            min_out,
            fee_symbol_or_mint,
            fee_amount,
            nonce,
        )| NttMessage {
            version,
            from_chain_id,
            to_chain_id,
            symbol_or_mint,
            amount,
            recipient: Recipient::MinOut(min_out),
            fee_amount,
            fee_symbol_or_mint,
            nonce,
        },
    )
    .parse(input)
}

#[cfg(test)]
mod tests {
    use super::*;
    use indoc::indoc;
    use nom::error::ErrorKind;

    #[test]
    fn test_parse() {
        let message = indoc! {"
            Fogo Bridge

            version: 0.2
            from_chain_id: foo
            to_chain_id: solana
            token: FOGO
            amount: 42.676
            recipient_address: 0xabc906d4A6074599D5471f04f9d6261030C8debe
            fee_token: USDC
            fee_amount: 0.001
            nonce: 1
        "};

        assert_eq!(
            TryInto::<BridgeMessage>::try_into(message.as_bytes().to_vec()).unwrap(),
            BridgeMessage::Ntt(NttMessage {
                version: Version { major: 0, minor: 2 },
                from_chain_id: "foo".to_string(),
                to_chain_id: "solana".to_string(),
                symbol_or_mint: SymbolOrMint::Symbol("FOGO".to_string()),
                amount: "42.676".to_string(),
                recipient: Recipient::Address("0xabc906d4A6074599D5471f04f9d6261030C8debe".to_string()),
                fee_symbol_or_mint: SymbolOrMint::Symbol("USDC".to_string()),
                fee_amount: "0.001".to_string(),
                nonce: 1
            })
        );
    }

    #[test]
    fn test_parse_v3_min_out() {
        let message = indoc! {"
            Fogo Bridge

            version: 0.3
            from_chain_id: fogo-mainnet
            to_chain_id: solana
            token: USDC.s
            amount: 10.000000
            min_out: 9850000000
            fee_token: USDC.s
            fee_amount: 2.000000
            nonce: 8"};

        assert_eq!(
            TryInto::<BridgeMessage>::try_into(message.as_bytes().to_vec()).unwrap(),
            BridgeMessage::Ntt(NttMessage {
                version: Version { major: 0, minor: 3 },
                from_chain_id: "fogo-mainnet".to_string(),
                to_chain_id: "solana".to_string(),
                symbol_or_mint: SymbolOrMint::Symbol("USDC.s".to_string()),
                amount: "10.000000".to_string(),
                recipient: Recipient::MinOut(9_850_000_000),
                fee_symbol_or_mint: SymbolOrMint::Symbol("USDC.s".to_string()),
                fee_amount: "2.000000".to_string(),
                nonce: 8
            })
        );
    }

    /// The whole point of the change: 0.3 is shorter than 0.2 by the margin a
    /// hardware wallet's offchain envelope needs.
    #[test]
    fn test_v3_is_shorter_than_v2_by_the_envelope() {
        let v2_line = "recipient_address: HaWyUXQZfHmX7ioQqre3cun14exxGcd3MqydjzVKsbyf";
        let v3_line = "min_out: 9850000000";
        assert!(v2_line.len() - v3_line.len() >= 20);
    }

    #[test]
    fn test_parse_with_unexpected_data_after_end() {
        let message = indoc! {"
            Fogo Bridge

            version: 0.2
            from_chain_id: foo
            to_chain_id: solana
            token: FOGO
            amount: 42.676
            recipient_address: 0xabc906d4A6074599D5471f04f9d6261030C8debe
            fee_token: USDC
            fee_amount: 0.001
            nonce: 1
            this data should not be here"};

        // Only that it is rejected. `alt` over the 0.2/0.3 shapes surfaces the
        // last branch's error, so pinning the nom code would assert which branch
        // ran last rather than the property under test.
        let result = TryInto::<BridgeMessage>::try_into(message.as_bytes().to_vec());
        assert!(result.is_err());
    }
}

#[cfg(test)]
mod hardware_wallet_envelope {
    use super::*;
    use anchor_lang::solana_program::{ed25519_program, instruction::Instruction, pubkey::Pubkey};
    use solana_intents::Intent;

    /// The exact ed25519 instruction the client emits for a hardware wallet:
    /// SRFC-3 V0 envelope, with `public_key_offset` pointing at the signer copy
    /// inside the message instead of carrying a second one.
    ///
    /// This needs `solana-intents` >= 0.1.3: 0.1.2 read the public key, signature
    /// and message *positionally* and ignored the offsets, so dropping the
    /// duplicate shifted everything and the last read ran off the end.
    #[test]
    fn test_srfc3_envelope_with_reused_key() {
        let signer = [7u8; 32];
        let msg = b"Fogo Bridge\n\nversion: 0.3\nfrom_chain_id: fogo-mainnet\nto_chain_id: solana\ntoken: USDC.s\namount: 1.000000\nmin_out: 869694908\nfee_token: USDC.s\nfee_amount: 2.000000\nnonce: 1";

        let mut env = Vec::new();
        env.extend_from_slice(b"\xffsolana offchain");
        env.push(0); // header V0
        env.extend_from_slice(&[0u8; 32]); // application domain
        env.push(1); // LimitedUtf8
        env.push(1); // one signer
        env.extend_from_slice(&signer);
        env.extend_from_slice(&(msg.len() as u16).to_le_bytes());
        env.extend_from_slice(msg);

        let key_at_in_env = 16 + 1 + 32 + 1 + 1;
        let sig_off: u16 = 16;
        let msg_off: u16 = sig_off + 64;

        let mut data = Vec::new();
        data.push(1); // num_signatures
        data.push(0); // padding
        data.extend_from_slice(&sig_off.to_le_bytes());
        data.extend_from_slice(&u16::MAX.to_le_bytes());
        data.extend_from_slice(&(msg_off + key_at_in_env as u16).to_le_bytes());
        data.extend_from_slice(&u16::MAX.to_le_bytes());
        data.extend_from_slice(&msg_off.to_le_bytes());
        data.extend_from_slice(&(env.len() as u16).to_le_bytes());
        data.extend_from_slice(&u16::MAX.to_le_bytes());
        data.extend_from_slice(&[9u8; 64]); // signature bytes are not checked here
        data.extend_from_slice(&env);

        let ix = Instruction {
            program_id: ed25519_program::ID,
            accounts: vec![],
            data,
        };
        let intent: Intent<BridgeMessage> = ix
            .try_into()
            .expect("SRFC-3 envelope with a reused signer key must deserialize");
        assert_eq!(intent.signer, Pubkey::new_from_array(signer));
        match intent.message {
            BridgeMessage::Ntt(m) => assert_eq!(m.recipient, Recipient::MinOut(869_694_908)),
        }
    }
}
