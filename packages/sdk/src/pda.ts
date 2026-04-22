import { PublicKey } from '@solana/web3.js'
import {
  CONFIG_SEED,
  FLOW_INBOUND_SEED,
  FLOW_OUTBOUND_SEED,
  REDEEMER_SEED,
  RELAYER_PROGRAM_ID,
  RELAYER_SEED,
} from './constants'

export function findConfigPda(programId: PublicKey = RELAYER_PROGRAM_ID) {
  return PublicKey.findProgramAddressSync([CONFIG_SEED], programId)
}

export function findAuthorityPda(programId: PublicKey = RELAYER_PROGRAM_ID) {
  return PublicKey.findProgramAddressSync([RELAYER_SEED], programId)
}

/**
 * Redeemer PDA — seeds=["redeemer"] under the relayer program id. Signs the
 * Token Bridge `CompleteWrappedWithPayload` CPI and owns the short-lived
 * USDC intake ATA that TB mints into. `claim_usdc` sweeps from that intake
 * ATA into the authority-owned long-lived ATA in the same transaction.
 */
export function findRedeemerAuthorityPda(programId: PublicKey = RELAYER_PROGRAM_ID) {
  return PublicKey.findProgramAddressSync([REDEEMER_SEED], programId)
}

export function findInflightFlowPda(
  gatewayClaim: PublicKey,
  programId: PublicKey = RELAYER_PROGRAM_ID,
) {
  return PublicKey.findProgramAddressSync(
    [FLOW_INBOUND_SEED, gatewayClaim.toBuffer()],
    programId,
  )
}

export function findOutflightFlowPda(
  nttInboxItem: PublicKey,
  programId: PublicKey = RELAYER_PROGRAM_ID,
) {
  return PublicKey.findProgramAddressSync(
    [FLOW_OUTBOUND_SEED, nttInboxItem.toBuffer()],
    programId,
  )
}
