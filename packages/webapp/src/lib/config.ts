import { BONYC_DECIMALS, USDC_DECIMALS } from '@fogo-onre/sdk'
import { Network } from '@fogo/sessions-sdk-react'
import { PublicKey } from '@solana/web3.js'

export const APP_NAME = 'Fogo OnRe'

// Domain the FogoSessionProvider hands to the paymaster. Must be a
// domain pre-registered with the Fogo paymaster service — otherwise
// `/api/sponsor_pubkey` returns 400 at session-establish time. The
// string is a lookup key, not the page's hostname, so a registered
// production domain (e.g. https://app.fogo-onre.example) works for
// local dev too. Set NEXT_PUBLIC_APP_DOMAIN per environment; see
// .env.example for the full story.
export const APP_DOMAIN
  // = process.env.NEXT_PUBLIC_APP_DOMAIN ?? 'https://app.fogo-onre.example'
  = process.env.NEXT_PUBLIC_APP_DOMAIN ?? 'https://app.ignitionfi.xyz'

// FOGO chain selection. Default mainnet — switch to testnet via env.
const NETWORK_NAME = process.env.NEXT_PUBLIC_FOGO_NETWORK ?? 'mainnet'
export const FOGO_NETWORK
  = NETWORK_NAME === 'testnet' ? Network.Testnet : Network.Mainnet

// RPC must match the selected network — wallet adapters reject session
// authorization when the chain id of the RPC doesn't match the one the
// wallet has authorized for this domain.
const DEFAULT_RPC_BY_NETWORK = {
  mainnet: 'https://mainnet.fogo.io',
  testnet: 'https://testnet.fogo.io',
} as const

export const FOGO_RPC_URL
  = process.env.NEXT_PUBLIC_FOGO_RPC_URL
    ?? DEFAULT_RPC_BY_NETWORK[NETWORK_NAME === 'testnet' ? 'testnet' : 'mainnet']

export const SOLANA_RPC_URL
  = process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? 'https://api.mainnet-beta.solana.com'

// USDC.s on FOGO — the NTT-bridged USDC (manager `nttu74…`, transceiver
// `9ioH2…`), peered to canonical USDC `EPjFWdd5…` on Solana. Source:
// https://configs.labsapis.com/mainnet/tokens.ntt.json (`USDC.s` entry).
export const USDC_S_MINT = new PublicKey('uSd2czE61Evaf76RNbq4KPpXnkiL3irdzgLFUMe3NoG')

// NTT-bridged ONyc on FOGO. The user receives this on deposit, burns it on withdraw.
// TODO: replace placeholder with the bONyc mint produced by the NTT setup
// (see docs/deploy-mainnet.md §7.1).
export const BONYC_MINT = new PublicKey('11111111111111111111111111111111')

// Token decimals are protocol invariants and live in the SDK.
export { BONYC_DECIMALS, USDC_DECIMALS }

