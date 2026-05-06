import { PublicKey } from '@solana/web3.js'
import IDL from './idl/fogo_onre_relayer.json' with { type: 'json' }

export const RELAYER_PROGRAM_ID = new PublicKey(IDL.address)
export const ONRE_PROGRAM_ID = new PublicKey('onreuGhHHgVzMWSkj2oQDLDtvvGvoepBPkqyaubFcwe')

/** NTT manager program for USDC.s on Solana mainnet. */
export const NTT_USDC_PROGRAM_ID = new PublicKey('nttu74CdAmsErx5daJVCQNoDZujswFrskMzonoZSdGk')

/** NTT manager program for ONyc on Solana mainnet. */
export const NTT_ONYC_PROGRAM_ID = new PublicKey('nttpna5vXW7BN2Aa4AfTbkCncJWTEoBsnWvjS87Xgsd')

/** OnRe's ONyc SPL mint on Solana mainnet. */
export const ONYC_MINT = new PublicKey('oNyCm1QsAatj3ckaEwZjtAPWvstPn3Zm5MAYPtkjEfa')

/** Canonical USDC on Solana mainnet — the Solana-side counterpart of FOGO USDC.s. */
export const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')

export const FOGO_WORMHOLE_CHAIN_ID = 51
export const SOLANA_WORMHOLE_CHAIN_ID = 1

export const CONFIG_SEED = Buffer.from('relayer_config')
export const RELAYER_SEED = Buffer.from('relayer')
export const FLOW_INBOUND_SEED = Buffer.from('inflight')
export const FLOW_OUTBOUND_SEED = Buffer.from('outflight')
export const REDEMPTION_TRACKER_SEED = Buffer.from('redemption_tracker')
export const NTT_SESSION_AUTHORITY_SEED = Buffer.from('session_authority')

export const USDC_DECIMALS = 6
export const ONYC_DECIMALS = 9
export const BONYC_DECIMALS = ONYC_DECIMALS

/** Denominator used by `applyFeeBps`. Matches the relayer's `10_000`. */
export const FEE_DENOMINATOR_BPS = 10_000n

/** Max bps the relayer will accept per leg. Matches `MAX_FEE_BPS = 1000` (10%). */
export const MAX_FEE_BPS = 1_000

/** Seconds in a 365-day year. Matches the architecture-doc price formula. */
export const SECONDS_PER_YEAR = 31_536_000n
