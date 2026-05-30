'use client'

/**
 * On-chain `FeeConfig` reader for intent_transfer's per-mint fee table.
 *
 * Layout (verified against intent-transfer IDL): 8-byte disc, then
 * u64 LE `intrachain_transfer_fee` (offset 8), u64 LE `bridge_transfer_fee`
 * (offset 16). Shared by `useBridgeFee` (form display) and
 * `createDepositBridgeContextProvider` (per-submit `feeAmount`).
 */

import type { Connection } from '@solana/web3.js'
import { PublicKey } from '@solana/web3.js'
import { DEPOSIT_INTENT_PROGRAM_ID } from '@/constants'

const FEE_CONFIG_SEED = Buffer.from('fee_config')
const FEE_CONFIG_BRIDGE_FEE_OFFSET = 16

/** Returns the canonical FeeConfig PDA for a given mint under intent_transfer. */
export function findFeeConfigPda(mint: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [FEE_CONFIG_SEED, mint.toBuffer()],
    DEPOSIT_INTENT_PROGRAM_ID,
  )
  return pda
}

/**
 * Reads `bridge_transfer_fee` (fee-mint base units) from the FeeConfig PDA.
 * Returns 0n if the account is missing or too short; the on-chain handler
 * validates against the live config at submit time regardless.
 */
export async function readBridgeTransferFee(
  connection: Connection,
  feeConfigPda: PublicKey,
): Promise<bigint> {
  const acct = await connection.getAccountInfo(feeConfigPda, 'confirmed')
  if (acct === null || acct.data.length < FEE_CONFIG_BRIDGE_FEE_OFFSET + 8) {
    return 0n
  }
  return acct.data.readBigUInt64LE(FEE_CONFIG_BRIDGE_FEE_OFFSET)
}
