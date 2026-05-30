import { FOGO_ONYC_DECIMALS, ONRE_INTENT_PROGRAM_ID, USDC_DECIMALS } from '@fogo-onre/sdk'
import { Network } from '@fogo/sessions-sdk-react'
import { PublicKey } from '@solana/web3.js'

export const APP_NAME = 'Fogo OnRe'

/**
 * Domain the FogoSessionProvider hands to the paymaster; must be
 * pre-registered or `/api/sponsor_pubkey` 400s at session establish.
 * Fallback is a real registered domain, so we warn instead of throwing
 * (throwing would break `next build` prerender on CI without the env var).
 */
const DEFAULT_APP_DOMAIN = 'https://app.ignitionfi.xyz'
function resolveAppDomain(): string {
  const fromEnv = process.env.NEXT_PUBLIC_APP_DOMAIN
  if (fromEnv && fromEnv.length > 0) {
    return fromEnv
  }
  if (process.env.NODE_ENV === 'production') {
    console.warn(
      `[fogo-onre] NEXT_PUBLIC_APP_DOMAIN not set; falling back to ${DEFAULT_APP_DOMAIN}. `
      + `Set it in your environment if you mean to register a different paymaster domain.`,
    )
  }
  return DEFAULT_APP_DOMAIN
}
export const APP_DOMAIN = resolveAppDomain()

// FOGO network enum for FogoSessionProvider. Default mainnet; RPC URLs
// resolve separately in `store/settings.ts`.
const NETWORK_NAME = process.env.NEXT_PUBLIC_FOGO_NETWORK ?? 'mainnet'
export const FOGO_NETWORK
  = NETWORK_NAME === 'testnet' ? Network.Testnet : Network.Mainnet

// USDC.s on FOGO — NTT-bridged USDC, peered to canonical Solana USDC.
// Source: configs.labsapis.com/mainnet/tokens.ntt.json (`USDC.s`).
export const USDC_S_MINT = new PublicKey('uSd2czE61Evaf76RNbq4KPpXnkiL3irdzgLFUMe3NoG')

// Canonical Solana USDC — Solana-side counterpart of USDC.s. Used to
// derive the OnRe Offer PDA `(usdcMint, onycMint)` for live price reads.
export const SOLANA_USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')

// NTT-bridged ONyc on FOGO. Received on deposit, burned on withdraw.
export const FOGO_ONYC_MINT = new PublicKey('oNyCm1QsAatj3ckaEwZjtAPWvstPn3Zm5MAYPtkjEfa')

// Per-call paymaster routing for the deposit bridge tx: OUR APP_DOMAIN
// lane under `OnReBridge`, so the bridge fee accrues to our sponsor ATA.
export const FOGO_BRIDGE_PAYMASTER_DOMAIN = APP_DOMAIN
export const FOGO_BRIDGE_VARIATION = 'OnReBridge'

// Program the deposit `bridge_ntt_tokens` ix targets: OnRe fork of Fogo's
// audited intent_transfer (declare_id! only). Swap to
// `INTENT_TRANSFER_PROGRAM_ID` to revert deposits to Fogo's program.
export const DEPOSIT_INTENT_PROGRAM_ID = ONRE_INTENT_PROGRAM_ID

// Same OnRe fork as deposit, kept as its own constant so a per-leg
// switch-back to `INTENT_TRANSFER_PROGRAM_ID` doesn't couple the legs.
export const REDEEM_INTENT_PROGRAM_ID = ONRE_INTENT_PROGRAM_ID

// FOGO-side NTT burning-mode managers, one per bridged mint; the
// user-signed `transfer_burn` ix targets these.
// USDC.s: configs.labsapis.com/mainnet/tokens.ntt.json (chain=Fogo);
// identical address to the Solana-side USDC manager.
export const FOGO_USDC_S_NTT_MANAGER_ID = new PublicKey('nttu74CdAmsErx5daJVCQNoDZujswFrskMzonoZSdGk')
// ONyc: same program ID deployed on both Solana (locking) and FOGO (burning).
export const FOGO_ONYC_NTT_MANAGER_ID = new PublicKey('nttpna5vXW7BN2Aa4AfTbkCncJWTEoBsnWvjS87Xgsd')

// FOGO Wormhole Core program (mainnet), pinned so the webapp can build
// `release_wormhole_outbound` without pulling in the cli/cranker.
export const FOGO_WORMHOLE_CORE_PROGRAM_ID = new PublicKey('worm2mrQkG1B1KTz37erMfWN8anHkSK24nzca7UD8BB')

// Custom deposit LUT (scripts/deploy-fogo-deposit-lut.mjs): superset of
// the Sessions-SDK bridging LUT plus 7 globals it misses when
// fee_token = wFOGO. Without it the deposit tx exceeds the 1232 B limit.
// Override via `NEXT_PUBLIC_FOGO_DEPOSIT_LUT` for a network swap/redeploy.
const FOGO_DEPOSIT_LUT_DEFAULT_BY_NETWORK: Partial<Record<Network, string>> = {
  [Network.Mainnet]: 'DDu9vk67v32ZzvUmD3knTByz3mFmdGyzD81h6vg9mUmD',
}
export const FOGO_DEPOSIT_LUT_OVERRIDE: string | null
  = process.env.NEXT_PUBLIC_FOGO_DEPOSIT_LUT
    ?? FOGO_DEPOSIT_LUT_DEFAULT_BY_NETWORK[FOGO_NETWORK]
    ?? null

// ONyc redeem-leg LUT (scripts/deploy-fogo-redeem-lut.mjs): deposit LUT
// contents ∪ the ONyc NTT/intent PDAs. Without it the redeem tx exceeds
// the 1232 B legacy limit.
const FOGO_REDEEM_LUT_DEFAULT_BY_NETWORK: Partial<Record<Network, string>> = {
  [Network.Mainnet]: '236GGhU46N4zzFz5d911GQgPLtZiyiunfsRjKEWNTCib',
}
export const FOGO_REDEEM_LUT_OVERRIDE: string | null
  = process.env.NEXT_PUBLIC_FOGO_REDEEM_LUT
    ?? FOGO_REDEEM_LUT_DEFAULT_BY_NETWORK[FOGO_NETWORK]
    ?? null

// Token decimals are protocol invariants and live in the SDK.
export { FOGO_ONYC_DECIMALS, USDC_DECIMALS }

// True iff the ONyc mint + FOGO ONyc NTT manager are real (not placeholder)
// AND `NEXT_PUBLIC_WITHDRAW_ENABLED` isn't 'false'. The env gate lets
// devnet/preview hide withdraw without a code change. Default enabled.
const PLACEHOLDER_PUBKEY = '11111111111111111111111111111111'
const ADDRESSES_REAL
  = FOGO_ONYC_MINT.toBase58() !== PLACEHOLDER_PUBKEY
    && FOGO_ONYC_NTT_MANAGER_ID.toBase58() !== PLACEHOLDER_PUBKEY
const WITHDRAW_ENABLED_ENV = process.env.NEXT_PUBLIC_WITHDRAW_ENABLED
const WITHDRAW_ENABLED = WITHDRAW_ENABLED_ENV !== 'false'
export const FOGO_ONYC_DEPLOYMENT_READY = ADDRESSES_REAL && WITHDRAW_ENABLED

// Redeem additionally needs the bridging LUT (see `FOGO_REDEEM_LUT_OVERRIDE`),
// else the redeem tx exceeds the legacy size limit. Set
// `NEXT_PUBLIC_FOGO_REDEEM_LUT=''` to force the "coming soon" gate back on.
export const FOGO_ONYC_REDEEM_READY = FOGO_ONYC_DEPLOYMENT_READY && FOGO_REDEEM_LUT_OVERRIDE !== null
