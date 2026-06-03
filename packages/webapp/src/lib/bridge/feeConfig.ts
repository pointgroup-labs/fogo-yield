'use client'

/**
 * On-chain `FeeConfig` reader for intent_transfer's per-mint fee table.
 *
 * Layout (verified against intent-transfer IDL): 8-byte disc, then
 * u64 LE `intrachain_transfer_fee` (offset 8), u64 LE `bridge_transfer_fee`
 * (offset 16), Pubkey `fee_recipient` (offset 24). Shared by `useBridgeFee`
 * (form display) and `createDepositBridgeContextProvider` (per-submit
 * `feeAmount` + fee-destination owner).
 */

import type { Connection } from '@solana/web3.js'
import { PublicKey } from '@solana/web3.js'
import { DEPOSIT_INTENT_PROGRAM_ID } from '@/constants'

const FEE_CONFIG_SEED = Buffer.from('fee_config')
const FEE_CONFIG_BRIDGE_FEE_OFFSET = 16
const FEE_CONFIG_RECIPIENT_OFFSET = 24

/** Returns the canonical FeeConfig PDA for a given mint under intent_transfer. */
export function findFeeConfigPda(mint: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [FEE_CONFIG_SEED, mint.toBuffer()],
    DEPOSIT_INTENT_PROGRAM_ID,
  )
  return pda
}

/**
 * Reads `bridge_transfer_fee` and `fee_recipient` from the FeeConfig PDA in a
 * single account fetch. `bridgeTransferFee` is 0n and `feeRecipient` is null
 * for a missing or un-migrated (old, shorter-layout) account; the on-chain
 * handler validates against the live config at submit time regardless. A null
 * `feeRecipient` lets the caller fall back to the legacy sponsor-owned ATA
 * during the migration window.
 */
export interface FeeConfigData {
  bridgeTransferFee: bigint
  feeRecipient: PublicKey | null
}

export async function readFeeConfig(
  connection: Connection,
  feeConfigPda: PublicKey,
): Promise<FeeConfigData> {
  const data = (await connection.getAccountInfo(feeConfigPda, 'confirmed'))?.data
  const bridgeTransferFee = data && data.length >= FEE_CONFIG_BRIDGE_FEE_OFFSET + 8
    ? data.readBigUInt64LE(FEE_CONFIG_BRIDGE_FEE_OFFSET)
    : 0n
  const feeRecipient = data && data.length >= FEE_CONFIG_RECIPIENT_OFFSET + 32
    ? new PublicKey(data.subarray(FEE_CONFIG_RECIPIENT_OFFSET, FEE_CONFIG_RECIPIENT_OFFSET + 32))
    : null
  return { bridgeTransferFee, feeRecipient }
}
