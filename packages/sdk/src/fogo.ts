import type { TransactionInstruction } from '@solana/web3.js'
import { PublicKey } from '@solana/web3.js'

/**
 * FOGO-side instruction builders for the user-facing deposit / withdraw
 * flows. The user signs ONE FOGO transaction; the rest of the chain is
 * cranked permissionlessly by anyone (including the relayer's own keeper).
 *
 * Both legs use Wormhole NTT (USDC.s out, bONyc out). NTT manager messages
 * carry `NttManagerMessage.sender = transfer_lock signer`, so the
 * originator's FOGO wallet is bound to the VAA without any custom payload.
 * The Solana relayer reads it back from the per-VAA inbox-item PDA.
 *
 * NOT IMPLEMENTED YET — these throw a clearly-typed error so the webapp
 * can render a "coming soon" state without stringly-coupled magic. Real
 * bodies need the FOGO NTT manager program IDs (USDC.s + bONyc), the
 * matching IDLs / discriminators, and the published peer registrations.
 */

export class FogoBuilderNotImplementedError extends Error {
  constructor(builder: string) {
    super(
      `${builder} is not implemented yet. The FOGO-side NTT manager `
      + `program IDs and IDLs need to be wired in. See packages/sdk/src/fogo.ts `
      + `for the expected interface.`,
    )
    this.name = 'FogoBuilderNotImplementedError'
  }
}

export interface BuildDepositTransferParams {
  /** User's FOGO wallet — signer; encoded as `NttManagerMessage.sender`. */
  payer: PublicKey
  /** USDC.s mint on FOGO. */
  usdcSMint: PublicKey
  /** Amount in USDC.s base units (6 decimals). */
  amount: bigint
  /** Solana-side relayer authority PDA — see `findAuthorityPda`. Owns the destination USDC ATA. */
  recipientOnSolana: PublicKey
}

/**
 * Build the FOGO NTT `transfer_lock` instruction that initiates a deposit.
 * The relayer cranks the Solana side via `claim_usdc` + `swap_usdc_to_onyc`
 * + `lock_onyc`, with the eventual bONyc routed back to `payer`.
 */
export function buildFogoNttDepositIx(
  _params: BuildDepositTransferParams,
): TransactionInstruction {
  throw new FogoBuilderNotImplementedError('buildFogoNttDepositIx')
}

export interface BuildWithdrawTransferParams {
  /** User's FOGO wallet — signer; encoded as `NttManagerMessage.sender`. */
  payer: PublicKey
  /** bONyc mint on FOGO (NTT-bridged ONyc). */
  bonycMint: PublicKey
  /** Amount in bONyc base units (9 decimals). */
  amount: bigint
  /** Solana-side relayer authority PDA — see `findAuthorityPda`. Owns the destination ONyc ATA. */
  recipientOnSolana: PublicKey
}

/**
 * Build the FOGO NTT `transfer_lock` instruction that initiates a withdraw.
 * The relayer cranks `unlock_onyc` + `request_redemption_onyc` +
 * `claim_redemption_usdc` + `send_usdc_to_user` on Solana, returning USDC.s
 * to `payer` on FOGO.
 */
export function buildFogoNttWithdrawIx(
  _params: BuildWithdrawTransferParams,
): TransactionInstruction {
  throw new FogoBuilderNotImplementedError('buildFogoNttWithdrawIx')
}
