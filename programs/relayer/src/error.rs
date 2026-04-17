use anchor_lang::prelude::*;

#[error_code]
pub enum RelayerError {
    #[msg("Relayer PDA has insufficient USDC balance for this operation")]
    InsufficientUsdcBalance,

    #[msg("Relayer PDA has insufficient ONyc balance for this operation")]
    InsufficientOnycBalance,

    #[msg("VAA verification failed or VAA is invalid")]
    InvalidVaa,

    #[msg("remaining_accounts split point is out of range")]
    InvalidAccountSplit,

    #[msg("Relayer authority PDA not present in forwarded CPI accounts")]
    AuthorityNotInAccounts,

    #[msg("VAA payload is shorter than the expected fogo_sender field")]
    VaaPayloadTooShort,

    #[msg("Parsed fogo_sender is the zero address")]
    ZeroFogoSender,

    #[msg("Caller is not the authority")]
    UnauthorizedAuthority,

    #[msg("Flow is not in the expected status for this operation")]
    FlowStatusMismatch,

    #[msg("Post-CPI balance is less than pre-CPI balance")]
    BalanceUnderflow,

    #[msg("Bridge or swap produced zero tokens")]
    ZeroAmountFlow,

    #[msg("Fee basis points exceed maximum (10000 = 100%)")]
    FeeBpsTooHigh,

    #[msg("Fee computation overflow")]
    FeeOverflow,
}
