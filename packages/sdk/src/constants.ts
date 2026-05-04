import { PublicKey } from '@solana/web3.js'
import IDL from './idl/fogo_onre_relayer.json' with { type: 'json' }

// ---------------------------------------------------------------------------
// Program IDs
// ---------------------------------------------------------------------------

export const RELAYER_PROGRAM_ID = new PublicKey(IDL.address)
export const ONRE_PROGRAM_ID = new PublicKey('onreuGhHHgVzMWSkj2oQDLDtvvGvoepBPkqyaubFcwe')
export const NTT_PROGRAM_ID = new PublicKey('nttu74CdAmsErx5daJVCQNoDZujswFrskMzonoZSdGk')

// ---------------------------------------------------------------------------
// Token mints (Solana)
// ---------------------------------------------------------------------------

/** OnRe's ONyc SPL mint on Solana mainnet. */
export const ONYC_MINT = new PublicKey('5Y8NV33Vv7WbnLfq3zBcKSdYPrk7g2KoiQoe7M2tcxp5')

// ---------------------------------------------------------------------------
// Wormhole
// ---------------------------------------------------------------------------

export const FOGO_WORMHOLE_CHAIN_ID = 51

// ---------------------------------------------------------------------------
// PDA seeds
// ---------------------------------------------------------------------------

export const CONFIG_SEED = Buffer.from('relayer_config')
export const RELAYER_SEED = Buffer.from('relayer')
export const FLOW_INBOUND_SEED = Buffer.from('inflight')
export const FLOW_OUTBOUND_SEED = Buffer.from('outflight')
export const REDEMPTION_TRACKER_SEED = Buffer.from('redemption_tracker')
export const NTT_SESSION_AUTHORITY_SEED = Buffer.from('session_authority')

// ---------------------------------------------------------------------------
// Token decimals
// ---------------------------------------------------------------------------

export const USDC_DECIMALS = 6
export const ONYC_DECIMALS = 9
export const BONYC_DECIMALS = ONYC_DECIMALS

// ---------------------------------------------------------------------------
// Fee math (mirrors programs/relayer/src/state.rs and constants.rs)
// ---------------------------------------------------------------------------

/** Denominator used by `applyFeeBps`. Matches the relayer's `10_000`. */
export const FEE_DENOMINATOR_BPS = 10_000n

/** Max bps the relayer will accept per leg. Matches `MAX_FEE_BPS = 1000` (10%). */
export const MAX_FEE_BPS = 1_000

/** Seconds in a 365-day year. Matches the architecture-doc price formula. */
export const SECONDS_PER_YEAR = 31_536_000n
