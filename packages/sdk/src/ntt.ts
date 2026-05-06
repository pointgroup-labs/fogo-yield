import type { AccountMeta } from '@solana/web3.js'
import { keccak_256 } from '@noble/hashes/sha3.js'
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { PublicKey, SystemProgram } from '@solana/web3.js'

const CONFIG_SEED = Buffer.from('config')
const NTT_MANAGER_PEER_SEED = Buffer.from('peer')
const REGISTERED_TRANSCEIVER_SEED = Buffer.from('registered_transceiver')
const INBOX_RATE_LIMIT_SEED = Buffer.from('inbox_rate_limit')
const OUTBOX_RATE_LIMIT_SEED = Buffer.from('outbox_rate_limit')
const INBOX_ITEM_SEED = Buffer.from('inbox_item')
const TOKEN_AUTHORITY_SEED = Buffer.from('token_authority')
const SESSION_AUTHORITY_SEED = Buffer.from('session_authority')

function chainIdBeBuf(chainId: number): Buffer {
  const buf = Buffer.alloc(2)
  buf.writeUInt16BE(chainId)
  return buf
}

export function findNttConfigPda(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([CONFIG_SEED], programId)
}

export function findNttPeerPda(
  chainId: number,
  programId: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [NTT_MANAGER_PEER_SEED, chainIdBeBuf(chainId)],
    programId,
  )
}

export function findRegisteredTransceiverPda(
  transceiver: PublicKey,
  programId: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [REGISTERED_TRANSCEIVER_SEED, transceiver.toBuffer()],
    programId,
  )
}

export function findInboxRateLimitPda(
  chainId: number,
  programId: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [INBOX_RATE_LIMIT_SEED, chainIdBeBuf(chainId)],
    programId,
  )
}

export function findOutboxRateLimitPda(
  programId: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([OUTBOX_RATE_LIMIT_SEED], programId)
}

export function findTokenAuthorityPda(
  programId: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([TOKEN_AUTHORITY_SEED], programId)
}

export function findInboxItemPda(
  messageHash: Uint8Array,
  programId: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [INBOX_ITEM_SEED, Buffer.from(messageHash)],
    programId,
  )
}

/**
 * NTT's `Config.custody` is set during `initialize` via the
 * `associated_token::mint = mint, associated_token::authority =
 * token_authority` Anchor constraints — i.e. the (possibly off-curve) ATA
 * of the manager's `token_authority` PDA for the bridged mint. Because
 * `initialize` is the only writer of `Config.custody` and the constraint
 * pins the address, custody is fully derivable from `(mint, programId)`
 * without an RPC fetch. Verified against FOGO mainnet USDC.s
 * (`uSd2czE…` / manager `nttu74…` → custody `F1dShvAq…`).
 */
export function findNttCustodyAta(
  mint: PublicKey,
  programId: PublicKey,
): PublicKey {
  const [tokenAuthorityPda] = findTokenAuthorityPda(programId)
  return getAssociatedTokenAddressSync(mint, tokenAuthorityPda, true)
}

/**
 * NTT binds the per-call `session_authority` PDA to a hash of the
 * outbound transfer args. The relayer pre-approves this PDA as SPL
 * delegate before invoking `transfer_lock`, so the SDK must compute the
 * exact same PDA the on-chain handler computes.
 */
export function findSessionAuthorityPda(
  fromOwner: PublicKey,
  argsHash: Uint8Array,
  programId: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SESSION_AUTHORITY_SEED, fromOwner.toBuffer(), Buffer.from(argsHash)],
    programId,
  )
}

/**
 * Compute the 32-byte hash of NTT `TransferArgs`, matching the on-chain
 * `TransferArgs::keccak256()` implementation:
 *   keccak256(amount BE u64 ‖ recipient_chain BE u16 ‖ recipient_address[32] ‖ should_queue u8)
 */
export interface NttTransferArgs {
  amount: bigint
  recipientChain: number
  recipientAddress: Uint8Array
  shouldQueue: boolean
}

export function nttTransferArgsHash(args: NttTransferArgs): Uint8Array {
  if (args.recipientAddress.length !== 32) {
    throw new Error('nttTransferArgsHash: recipientAddress must be 32 bytes')
  }
  const buf = new Uint8Array(8 + 2 + 32 + 1)
  const view = new DataView(buf.buffer)
  view.setBigUint64(0, args.amount, false) // BE
  view.setUint16(8, args.recipientChain, false) // BE
  buf.set(args.recipientAddress, 10)
  buf[42] = args.shouldQueue ? 1 : 0
  return keccak_256(buf)
}

/**
 * Borsh-encode `TransferArgs` for the NTT instruction `data` payload.
 * Distinct from `nttTransferArgsHash`: borsh is little-endian, ChainId is
 * a single u16 field, and the encoder produces 43 bytes (no discriminator).
 */
export function encodeNttTransferArgsBorsh(args: NttTransferArgs): Uint8Array {
  if (args.recipientAddress.length !== 32) {
    throw new Error('encodeNttTransferArgsBorsh: recipientAddress must be 32 bytes')
  }
  const buf = new Uint8Array(8 + 2 + 32 + 1)
  const view = new DataView(buf.buffer)
  view.setBigUint64(0, args.amount, true) // LE
  view.setUint16(8, args.recipientChain, true) // LE
  buf.set(args.recipientAddress, 10)
  buf[42] = args.shouldQueue ? 1 : 0
  return buf
}

/**
 * Inputs needed to build the NTT redeem + release_inbound_unlock account
 * lists for `unlock_onyc`. Everything here is derivable from on-chain NTT
 * state EXCEPT the per-VAA accounts (`nttInboxItem`, `nttTransceiverMessage`)
 * which are addressable only off-chain via the relayer's VAA pipeline.
 *
 * NOTE: source chain is fixed to FOGO (51). The relayer-program does not
 * support any other source, and exposing a chain override would let the
 * SDK build PDAs (peer, inbox_rate_limit) that the on-chain code can never
 * match, silently breaking the CPI.
 */
export interface NttRedeemContext {
  /** Address of the registered transceiver program (for OnRe = NTT itself). */
  transceiverAddress: PublicKey
}

/**
 * Build the 14-entry account list expected by NTT v1's outbound
 * `transfer_lock` instruction. Mode-, mint-, and program-id-agnostic — the
 * relayer's Solana-side `lock_onyc` / `send_usdc_to_user` use it under the
 * canonical per-leg NTT program ID (USDC.s or ONyc) with the relayer authority PDA as the
 * non-signer source owner; FOGO-side user-signed flows use it with the
 * FOGO NTT manager program ID and the user's wallet as a signer source.
 *
 * The order matches the NTT v1 `TransferLock` Anchor accounts struct
 * (verified against the relayer's Rust `lock_onyc` handler). Reordering
 * any entry silently breaks the CPI — keep these in lockstep with NTT
 * upstream.
 */
export interface BuildNttTransferLockAccountListParams {
  /** NTT manager program id — Solana for relayer-side, FOGO-side for user-signed. */
  nttProgramId: PublicKey
  /** Source token-account owner. PDA on the relayer side, user wallet on the user side. */
  fromOwner: PublicKey
  /** True iff `fromOwner` is a tx-level signer (user-side); false when signed via PDA seeds. */
  fromOwnerIsSigner: boolean
  /** SPL token account holding the tokens to transfer. */
  fromTokenAccount: PublicKey
  /** Mint of `fromTokenAccount`. */
  mint: PublicKey
  /** Fresh keypair pubkey — must sign and is `init`'d as the per-call outbox item. */
  outboxItem: PublicKey
  /** Wormhole chain id of the destination chain. */
  recipientChain: number
  /** 32-byte address on the destination chain (left-padded as needed). */
  recipientAddress: Uint8Array
  /** Transfer amount in token base units. */
  amount: bigint
  /** Optional NTT outbound queue toggle; defaults false (immediate send). */
  shouldQueue?: boolean
}

export function buildNttTransferLockAccountList(
  params: BuildNttTransferLockAccountListParams,
): AccountMeta[] {
  const shouldQueue = params.shouldQueue ?? false
  const [configPda] = findNttConfigPda(params.nttProgramId)
  const [peerPda] = findNttPeerPda(params.recipientChain, params.nttProgramId)
  const [outboxRateLimitPda] = findOutboxRateLimitPda(params.nttProgramId)
  const [inboxRateLimitPda] = findInboxRateLimitPda(params.recipientChain, params.nttProgramId)
  const [tokenAuthorityPda] = findTokenAuthorityPda(params.nttProgramId)
  const custody = findNttCustodyAta(params.mint, params.nttProgramId)

  const argsHash = nttTransferArgsHash({
    amount: params.amount,
    recipientChain: params.recipientChain,
    recipientAddress: params.recipientAddress,
    shouldQueue,
  })
  const [sessionAuthorityPda] = findSessionAuthorityPda(
    params.fromOwner,
    argsHash,
    params.nttProgramId,
  )

  return [
    { pubkey: params.fromOwner, isSigner: params.fromOwnerIsSigner, isWritable: true },
    { pubkey: configPda, isSigner: false, isWritable: false },
    { pubkey: params.mint, isSigner: false, isWritable: true },
    { pubkey: params.fromTokenAccount, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: params.outboxItem, isSigner: true, isWritable: true },
    { pubkey: outboxRateLimitPda, isSigner: false, isWritable: true },
    { pubkey: custody, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: inboxRateLimitPda, isSigner: false, isWritable: true },
    { pubkey: peerPda, isSigner: false, isWritable: false },
    { pubkey: sessionAuthorityPda, isSigner: false, isWritable: false },
    { pubkey: tokenAuthorityPda, isSigner: false, isWritable: false },
    { pubkey: params.nttProgramId, isSigner: false, isWritable: false },
  ]
}
