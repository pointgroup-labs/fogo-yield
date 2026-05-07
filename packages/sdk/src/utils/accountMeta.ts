import type { AccountMeta, PublicKey } from '@solana/web3.js'

/**
 * Tiny constructors for `AccountMeta` literals.
 *
 * Anchor + web3.js consumers expect the `{ pubkey, isSigner, isWritable }`
 * shape unchanged; these helpers exist purely to make the
 * `remainingAccounts` builders read as a list of *roles* (writable /
 * read-only / signer-writable) rather than a wall of three-key object
 * literals where every line has to be visually parsed for two boolean
 * flags. The byte-level output is identical to the prior literals.
 */

/** Writable, non-signer. The default flavour for SPL token accounts. */
export function writable(pubkey: PublicKey): AccountMeta {
  return { pubkey, isSigner: false, isWritable: true }
}

/** Read-only, non-signer. Mints, sysvars, programs, PDAs read by the handler. */
export function readonly(pubkey: PublicKey): AccountMeta {
  return { pubkey, isSigner: false, isWritable: false }
}

/** Signer + writable. PDA "signers" rely on `invoke_signed` upstream. */
export function signerWritable(pubkey: PublicKey): AccountMeta {
  return { pubkey, isSigner: true, isWritable: true }
}
