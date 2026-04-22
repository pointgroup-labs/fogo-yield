import type { LiteSVM } from 'litesvm'
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createInitializeMint2Instruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token'
import { Keypair, PublicKey, SystemProgram, Transaction } from '@solana/web3.js'

/** Minimum lamports for a rent-exempt Mint account (82 bytes, hardcoded). */
const MINT_RENT = 1_461_600

/** Build a Transaction with a recent blockhash from LiteSVM. */
function buildTx(svm: LiteSVM, payer: PublicKey): Transaction {
  const tx = new Transaction()
  tx.recentBlockhash = svm.latestBlockhash()
  tx.feePayer = payer
  return tx
}

/** Create a new SPL token mint inside LiteSVM. Returns the mint keypair. */
export function createMint(svm: LiteSVM, payer: Keypair, decimals = 6): Keypair {
  const mint = Keypair.generate()
  const tx = buildTx(svm, payer.publicKey)
  tx.add(
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: mint.publicKey,
      lamports: MINT_RENT,
      space: MINT_SIZE,
      programId: TOKEN_PROGRAM_ID,
    }),
    createInitializeMint2Instruction(mint.publicKey, decimals, payer.publicKey, null),
  )
  tx.sign(payer, mint)
  svm.sendTransaction(tx)
  return mint
}

/** Create an ATA and mint tokens into it. Returns the ATA address. */
export function mintTo(
  svm: LiteSVM,
  payer: Keypair,
  mint: PublicKey,
  owner: PublicKey,
  amount: bigint | number,
): PublicKey {
  const ata = getAssociatedTokenAddressSync(mint, owner, true)
  const tx = buildTx(svm, payer.publicKey)
  tx.add(
    createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, ata, owner, mint),
    createMintToInstruction(mint, ata, payer.publicKey, amount),
  )
  tx.sign(payer)
  svm.sendTransaction(tx)
  return ata
}

/** Create an ATA (no minting). Returns the ATA address. */
export function createAta(
  svm: LiteSVM,
  payer: Keypair,
  mint: PublicKey,
  owner: PublicKey,
): PublicKey {
  const ata = getAssociatedTokenAddressSync(mint, owner, true)
  const tx = buildTx(svm, payer.publicKey)
  tx.add(
    createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, ata, owner, mint),
  )
  tx.sign(payer)
  svm.sendTransaction(tx)
  return ata
}

/**
 * Create an SPL mint and patch its `mint_authority` to a specific PDA.
 * SPL Mint layout: mint_authority_option(4) + mint_authority(32) + ...
 *
 * Used by NTT-flow tests so the test mint mirrors mainnet ONyc (whose mint
 * authority is OnRe's mint_authority PDA on real mainnet).
 */
export function createMintWithAuthority(
  svm: LiteSVM,
  payer: Keypair,
  mintAuthority: PublicKey,
  decimals = 6,
): Keypair {
  const mint = createMint(svm, payer, decimals)
  const acct = svm.getAccount(mint.publicKey)
  if (!acct) {
    throw new Error('createMintWithAuthority: mint not found after creation')
  }
  const data = new Uint8Array(acct.data)
  data.set(mintAuthority.toBytes(), 4)
  svm.setAccount(mint.publicKey, { ...acct, data })
  return mint
}

/**
 * Inject a raw, pre-initialized SPL Token account at an arbitrary address.
 * Bypasses the ATA program — use when the test needs a token account at a
 * non-canonical address (e.g. a PDA owned by another program).
 *
 * SPL TokenAccount layout (165 bytes): mint(32) + owner(32) + amount(u64) +
 *   delegate_option(36) + state(1) + ... — only the first 109 bytes matter
 *   for read-only consumers; the rest stays zero.
 */
export function createTokenAccount(
  svm: LiteSVM,
  address: PublicKey,
  mint: PublicKey,
  owner: PublicKey,
  amount: bigint = 0n,
): void {
  const data = new Uint8Array(165)
  data.set(mint.toBytes(), 0)
  data.set(owner.toBytes(), 32)
  const view = new DataView(data.buffer, data.byteOffset)
  view.setBigUint64(64, amount, true)
  data[108] = 1 // state = Initialized
  svm.setAccount(address, {
    executable: false,
    owner: TOKEN_PROGRAM_ID,
    lamports: 2_039_280,
    data,
    rentEpoch: 0,
  })
}
