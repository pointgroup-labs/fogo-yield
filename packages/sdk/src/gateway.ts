/**
 * Wormhole Token Bridge (a.k.a. "Gateway" in the relayer constants)
 * account-builder helpers for `complete_wrapped_with_payload` (claim_usdc)
 * and `transfer_wrapped_with_payload` (send_usdc_to_user).
 *
 * USDC.s on FOGO is bridged to Solana via Token Bridge in *wrapped* mode —
 * USDC's canonical chain (in this design) is FOGO, and Solana sees a
 * wrapped representation. The Solana Token Bridge instruction enum:
 *   ... CompleteWrappedWithPayload(10), TransferWrappedWithPayload(11) ...
 *
 * The CLAIM path (`buildClaimWrappedRemainingAccounts` + its PDA helpers)
 * is exercised end-to-end by `tests/deposit-flow-e2e.test.ts` against the
 * real Token Bridge binary loaded into litesvm.
 *
 * @unverified — the TRANSFER path (`buildTransferWrappedRemainingAccounts`
 * and the `@unverified`-tagged PDA helpers below) is not yet covered by
 * an e2e test. PDA seeds come from Wormhole's published Solana Token
 * Bridge source (https://github.com/wormhole-foundation/wormhole) and
 * the typed CPI account interfaces in
 * @wormhole-foundation/sdk-solana-tokenbridge. Treat as
 * documentation-as-code: if you hit "AccountNotFound" or wrong account
 * ordering at the Gateway CPI, fix the helper and add an e2e test.
 */

import { TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { PublicKey, SystemProgram, SYSVAR_CLOCK_PUBKEY, SYSVAR_RENT_PUBKEY } from '@solana/web3.js'
import {
  GATEWAY_PROGRAM_ID,
  RELAYER_PROGRAM_ID,
  WORMHOLE_CORE_BRIDGE_ID,
} from './constants'

// ---------------------------------------------------------------------------
// Token Bridge PDA seeds — from solana/modules/token_bridge/program/src
// ---------------------------------------------------------------------------

const TB_CONFIG_SEED = Buffer.from('config')
const TB_AUTHORITY_SIGNER_SEED = Buffer.from('authority_signer')
const TB_CUSTODY_SIGNER_SEED = Buffer.from('custody_signer')
// Upstream seed string is "mint_signer" — confirmed both via Wormhole source
// (`pub type MintSigner = Derive<Info, "mint_signer">;`) and by deriving the
// PDA against the captured mainnet fixture in tests/fixtures/accounts/.
const TB_MINT_AUTHORITY_SEED = Buffer.from('mint_signer')
const TB_EMITTER_SEED = Buffer.from('emitter')
const TB_SENDER_SEED = Buffer.from('sender')
const TB_REDEEMER_SEED = Buffer.from('redeemer')
const TB_WRAPPED_SEED = Buffer.from('wrapped')
const TB_WRAPPED_META_SEED = Buffer.from('meta')

const CORE_SEQUENCE_SEED = Buffer.from('Sequence')

function chainIdBeBuf(chainId: number): Buffer {
  const buf = Buffer.alloc(2)
  buf.writeUInt16BE(chainId)
  return buf
}

// ---------------------------------------------------------------------------
// PDA derivations — all under GATEWAY_PROGRAM_ID unless noted
// ---------------------------------------------------------------------------

/** Token Bridge config: seeds=["config"]. */
export function findTokenBridgeConfigPda(programId: PublicKey = GATEWAY_PROGRAM_ID): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([TB_CONFIG_SEED], programId)
}

/** @unverified Token Bridge authority_signer (delegate for outbound transfers). */
export function findTokenBridgeAuthoritySignerPda(programId: PublicKey = GATEWAY_PROGRAM_ID): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([TB_AUTHORITY_SIGNER_SEED], programId)
}

/** @unverified Token Bridge custody_signer (signs custody token-account ops). */
export function findTokenBridgeCustodySignerPda(programId: PublicKey = GATEWAY_PROGRAM_ID): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([TB_CUSTODY_SIGNER_SEED], programId)
}

/** Token Bridge mint_authority (mint authority for wrapped tokens). */
export function findTokenBridgeMintAuthorityPda(programId: PublicKey = GATEWAY_PROGRAM_ID): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([TB_MINT_AUTHORITY_SEED], programId)
}

/** @unverified Token Bridge emitter (Wormhole emitter address for outbound msgs). */
export function findTokenBridgeEmitterPda(programId: PublicKey = GATEWAY_PROGRAM_ID): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([TB_EMITTER_SEED], programId)
}

/** @unverified Caller-program-scoped `sender` PDA — seeds=["sender", caller_program_id]. */
export function findTokenBridgeSenderPda(
  callerProgramId: PublicKey = RELAYER_PROGRAM_ID,
  programId: PublicKey = GATEWAY_PROGRAM_ID,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [TB_SENDER_SEED, callerProgramId.toBuffer()],
    programId,
  )
}

/**
 * Caller-program-scoped `redeemer` PDA — seeds=["redeemer"] under the
 * CALLER program id (not the Gateway program). Token Bridge requires the
 * receiver program to sign as this PDA during `CompleteWrappedWithPayload`
 * as proof the payload reached its intended target.
 */
export function findTokenBridgeRedeemerPda(
  callerProgramId: PublicKey = RELAYER_PROGRAM_ID,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [TB_REDEEMER_SEED],
    callerProgramId,
  )
}

/**
 * Wrapped mint PDA — seeds=["wrapped", chain_id_be, token_address[32]].
 *
 * `chainId` is the Wormhole chain ID where the underlying token is canonical
 * (FOGO = 51 for USDC.s). `tokenAddress` is the 32-byte address of that
 * token on that chain (left-padded if shorter than 32 bytes).
 */
export function findTokenBridgeWrappedMintPda(
  chainId: number,
  tokenAddress: Uint8Array,
  programId: PublicKey = GATEWAY_PROGRAM_ID,
): [PublicKey, number] {
  if (tokenAddress.length !== 32) {
    throw new Error(`tokenAddress must be 32 bytes, got ${tokenAddress.length}`)
  }
  return PublicKey.findProgramAddressSync(
    [TB_WRAPPED_SEED, chainIdBeBuf(chainId), Buffer.from(tokenAddress)],
    programId,
  )
}

/** Wrapped-mint metadata PDA — seeds=["meta", wrapped_mint]. */
export function findTokenBridgeWrappedMetaPda(
  wrappedMint: PublicKey,
  programId: PublicKey = GATEWAY_PROGRAM_ID,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [TB_WRAPPED_META_SEED, wrappedMint.toBuffer()],
    programId,
  )
}

/**
 * Foreign endpoint PDA — seeds=[chain_id_be, emitter_address[32]].
 *
 * Per-source-chain registration of the canonical Token Bridge emitter on
 * that chain. The relayer must use the FOGO Token Bridge emitter address
 * here when claiming inbound USDC.s.
 */
export function findTokenBridgeForeignEndpointPda(
  chainId: number,
  emitterAddress: Uint8Array,
  programId: PublicKey = GATEWAY_PROGRAM_ID,
): [PublicKey, number] {
  if (emitterAddress.length !== 32) {
    throw new Error(`emitterAddress must be 32 bytes, got ${emitterAddress.length}`)
  }
  return PublicKey.findProgramAddressSync(
    [chainIdBeBuf(chainId), Buffer.from(emitterAddress)],
    programId,
  )
}

/** @unverified Core Bridge sequence-tracker PDA — seeds=["Sequence", emitter]. */
export function findCoreBridgeSequencePda(
  emitter: PublicKey,
  programId: PublicKey = WORMHOLE_CORE_BRIDGE_ID,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [CORE_SEQUENCE_SEED, emitter.toBuffer()],
    programId,
  )
}

/** @unverified Core Bridge config PDA — seeds=["Bridge"]. */
export function findCoreBridgeConfigPda(
  programId: PublicKey = WORMHOLE_CORE_BRIDGE_ID,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from('Bridge')], programId)
}

/** @unverified Core Bridge fee collector PDA — seeds=["fee_collector"]. */
export function findCoreBridgeFeeCollectorPda(
  programId: PublicKey = WORMHOLE_CORE_BRIDGE_ID,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from('fee_collector')], programId)
}

// ---------------------------------------------------------------------------
// Named-fields contexts the SDK methods consume
// ---------------------------------------------------------------------------

/**
 * Caller-supplied "anchor points" for `claimUsdc`. These are the
 * accounts the SDK can't derive without knowing the wrapped token's source
 * chain + address. The remaining ~10 accounts are derived internally from
 * these inputs plus the relayer's PDAs.
 */
export interface TokenBridgeClaimContext {
  /** Wrapped USDC.s mint address on Solana (derivable but accepted explicitly to avoid surprises). */
  wrappedMint: PublicKey
  /** Token Bridge emitter address on FOGO (32 bytes, used for foreign_endpoint PDA). */
  foreignEmitter: Uint8Array
  /** Source chain ID (FOGO = 51). */
  fromChain?: number
}

/**
 * @unverified Caller-supplied "anchor points" for `sendUsdcToUser`. The
 * `message` keypair is required because the Token Bridge `transfer_*`
 * instructions create a fresh message account inside the CPI.
 */
export interface TokenBridgeTransferContext {
  /** Wrapped USDC.s mint address on Solana. */
  wrappedMint: PublicKey
  /** Recipient chain ID (FOGO = 51). */
  recipientChain?: number
}

// ---------------------------------------------------------------------------
// Builders — array assembly believed-correct from Wormhole reference impl
// ---------------------------------------------------------------------------

/**
 * Build the `AccountMeta` list for Token Bridge
 * `CompleteWrappedWithPayload`. Order mirrors the upstream
 * `CompleteWrappedWithPayloadData` Solitaire account struct, with the
 * Gateway program appended last so `invoke_signed` can resolve it.
 *
 * Derived inputs:
 * - `payer` (signer/mut) — from caller
 * - `tokenBridgeConfig` — PDA
 * - `vaa` — from caller (already validated by Core Bridge)
 * - `tokenBridgeClaim` — from caller (CPI-created, also seed for our flow)
 * - `tokenBridgeForeignEndpoint` — derived from (fromChain, foreignEmitter)
 * - `toTokenAccount` (mut) — short-lived USDC intake ATA owned by the
 *    **redeemer** PDA. TB enforces `redeemer.key == to.owner`, so this
 *    must NOT be the authority-owned long-lived ATA. `claim_usdc` sweeps
 *    the received balance into the authority-owned ATA in the same ix.
 * - `tokenBridgeRedeemer` — derived from caller-program-id (= relayer ID)
 * - `feeRecipient` (mut) — same as toTokenAccount when no fee
 * - `wrappedMint` (mut) — from caller
 * - `tokenBridgeWrappedMeta` — derived from wrappedMint
 * - `tokenBridgeMintAuthority` — PDA
 * - `rent` — sysvar
 * - `systemProgram`
 * - `wormholeProgram` (Core Bridge)
 * - `tokenProgram`
 */
export function buildClaimWrappedRemainingAccounts(params: {
  payer: PublicKey
  vaa: PublicKey
  gatewayClaim: PublicKey
  toTokenAccount: PublicKey
  /**
   * Relayer authority PDA. Appended at the tail so the relayer's CPI helper
   * (`invoke_relayer_signed`) can locate it and force its signer flag
   * before the `invoke_signed` into Token Bridge. TB itself reads only the
   * first 14 entries (`CompleteWrappedWithPayload` Solitaire accounts) and
   * ignores extras.
   */
  relayerAuthority: PublicKey
  ctx: TokenBridgeClaimContext
  callerProgramId?: PublicKey
}) {
  const fromChain = params.ctx.fromChain ?? 51
  const callerId = params.callerProgramId ?? RELAYER_PROGRAM_ID
  const [config] = findTokenBridgeConfigPda()
  const [foreignEndpoint] = findTokenBridgeForeignEndpointPda(fromChain, params.ctx.foreignEmitter)
  const [redeemer] = findTokenBridgeRedeemerPda(callerId)
  const [wrappedMeta] = findTokenBridgeWrappedMetaPda(params.ctx.wrappedMint)
  const [mintAuthority] = findTokenBridgeMintAuthorityPda()

  return [
    { pubkey: params.payer, isSigner: true, isWritable: true },
    { pubkey: config, isSigner: false, isWritable: false },
    { pubkey: params.vaa, isSigner: false, isWritable: false },
    { pubkey: params.gatewayClaim, isSigner: false, isWritable: true },
    { pubkey: foreignEndpoint, isSigner: false, isWritable: false },
    { pubkey: params.toTokenAccount, isSigner: false, isWritable: true },
    // Redeemer PDA. Outer tx uses `isSigner: false` (PDAs can't sign the
    // outer transaction); the relayer's `invoke_relayer_signed` helper flips
    // the flag at CPI dispatch and uses invoke_signed with ["redeemer"] seeds.
    { pubkey: redeemer, isSigner: false, isWritable: false },
    { pubkey: params.toTokenAccount, isSigner: false, isWritable: true }, // fee_recipient
    { pubkey: params.ctx.wrappedMint, isSigner: false, isWritable: true },
    { pubkey: wrappedMeta, isSigner: false, isWritable: false },
    { pubkey: mintAuthority, isSigner: false, isWritable: false },
    { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: WORMHOLE_CORE_BRIDGE_ID, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: GATEWAY_PROGRAM_ID, isSigner: false, isWritable: false },
    // Trailing relayer-authority PDA for `invoke_relayer_signed`. Solitaire
    // (TB) only reads the first 14 named accounts; this extra is harmless.
    { pubkey: params.relayerAuthority, isSigner: false, isWritable: false },
  ]
}

/**
 * @unverified Build the `AccountMeta` list for Token Bridge
 * `TransferWrappedWithPayload`. Order mirrors the upstream
 * `TransferWrappedWithPayloadData` Solitaire account struct.
 *
 * The `message` keypair must also be passed to `.signers([...])` on the
 * Anchor builder — the CPI initializes it inside the Core Bridge call.
 */
export function buildTransferWrappedRemainingAccounts(params: {
  payer: PublicKey
  fromTokenAccount: PublicKey
  fromOwner: PublicKey
  message: PublicKey
  ctx: TokenBridgeTransferContext
  callerProgramId?: PublicKey
}) {
  const callerId = params.callerProgramId ?? RELAYER_PROGRAM_ID
  const [config] = findTokenBridgeConfigPda()
  const [authoritySigner] = findTokenBridgeAuthoritySignerPda()
  const [wrappedMeta] = findTokenBridgeWrappedMetaPda(params.ctx.wrappedMint)
  const [emitter] = findTokenBridgeEmitterPda()
  const [sender] = findTokenBridgeSenderPda(callerId)
  const [sequence] = findCoreBridgeSequencePda(emitter)
  const [coreBridge] = findCoreBridgeConfigPda()
  const [feeCollector] = findCoreBridgeFeeCollectorPda()

  return [
    { pubkey: params.payer, isSigner: true, isWritable: true },
    { pubkey: config, isSigner: false, isWritable: false },
    { pubkey: params.fromTokenAccount, isSigner: false, isWritable: true },
    { pubkey: params.fromOwner, isSigner: false, isWritable: false }, // delegate-via-PDA
    { pubkey: params.ctx.wrappedMint, isSigner: false, isWritable: true },
    { pubkey: wrappedMeta, isSigner: false, isWritable: false },
    { pubkey: authoritySigner, isSigner: false, isWritable: false },
    { pubkey: coreBridge, isSigner: false, isWritable: true },
    { pubkey: params.message, isSigner: true, isWritable: true },
    { pubkey: emitter, isSigner: false, isWritable: false },
    { pubkey: sequence, isSigner: false, isWritable: true },
    { pubkey: feeCollector, isSigner: false, isWritable: true },
    { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
    { pubkey: sender, isSigner: false, isWritable: false },
    { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: WORMHOLE_CORE_BRIDGE_ID, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: GATEWAY_PROGRAM_ID, isSigner: false, isWritable: false },
  ]
}
