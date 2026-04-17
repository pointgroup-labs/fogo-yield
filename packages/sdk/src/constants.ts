import { PublicKey } from '@solana/web3.js'
import IDL from './idl/fogo_relayer.json'

// ---------------------------------------------------------------------------
// Program IDs
// ---------------------------------------------------------------------------

export const RELAYER_PROGRAM_ID = new PublicKey(IDL.address)
export const ONRE_PROGRAM_ID = new PublicKey('onreuGhHHgVzMWSkj2oQDLDtvvGvoepBPkqyaubFcwe')
export const WORMHOLE_CORE_BRIDGE_ID = new PublicKey('worm2ZoG2kUd4vFXhvjh93UUH596ayRfgQ2MgjNMTth')
export const GATEWAY_PROGRAM_ID = new PublicKey('wormDTUJ6AWPNvk59vGQbDvGJmqbDTdgWgAqcLBCgUb')
export const NTT_PROGRAM_ID = new PublicKey('nttiK1SepaQt6sZ4WGW5whvc9tEnGXGxuKeptcQPCcS')

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
