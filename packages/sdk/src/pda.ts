import { PublicKey } from '@solana/web3.js'
import {
  CONFIG_SEED,
  FLOW_INBOUND_SEED,
  FLOW_OUTBOUND_SEED,
  RELAYER_PROGRAM_ID,
  RELAYER_SEED,
} from './constants'

export function findConfigPda(programId: PublicKey = RELAYER_PROGRAM_ID) {
  return PublicKey.findProgramAddressSync([CONFIG_SEED], programId)
}

export function findAuthorityPda(programId: PublicKey = RELAYER_PROGRAM_ID) {
  return PublicKey.findProgramAddressSync([RELAYER_SEED], programId)
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
