import { PublicKey } from '@solana/web3.js'
import {
  CONFIG_SEED,
  FLOW_INBOUND_SEED,
  FLOW_OUTBOUND_SEED,
  INTENT_TRANSFER_PROGRAM_ID,
  INTENT_TRANSFER_SETTER_SEED,
  REDEMPTION_TRACKER_SEED,
  RELAYER_PROGRAM_ID,
  RELAYER_SEED,
  USER_INBOX_SEED,
} from './constants'

export function findConfigPda(programId: PublicKey = RELAYER_PROGRAM_ID) {
  return PublicKey.findProgramAddressSync([CONFIG_SEED], programId)
}

export function findAuthorityPda(programId: PublicKey = RELAYER_PROGRAM_ID) {
  return PublicKey.findProgramAddressSync([RELAYER_SEED], programId)
}

export function findInflightFlowPda(
  nttInboxItem: PublicKey,
  programId: PublicKey = RELAYER_PROGRAM_ID,
) {
  return PublicKey.findProgramAddressSync(
    [FLOW_INBOUND_SEED, nttInboxItem.toBuffer()],
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

/**
 * Singleton redemption-tracker PDA — seeds=["redemption_tracker"] under the
 * relayer program id. Created by `request_redemption_onyc`, closed by
 * `claim_redemption_usdc` or `cancel_redemption_onyc`. Doubles as the
 * in-flight mutex (PDA existence ⇒ a withdraw redemption is mid-flight).
 *
 * The same PDA address is *also* required by `send_usdc_to_user` as a
 * `SystemAccount`-typed gate: send proceeds iff the PDA is system-owned
 * (i.e. doesn't currently exist), preventing concurrent USDC outflows from
 * polluting an in-flight redemption's snapshot→reload delta math.
 */
export function findRedemptionTrackerPda(programId: PublicKey = RELAYER_PROGRAM_ID) {
  return PublicKey.findProgramAddressSync([REDEMPTION_TRACKER_SEED], programId)
}

/**
 * Per-user inbox authority PDA — `[USER_INBOX_SEED, wallet]` under the
 * relayer program. Used as `recipient_address` in the user-signed FOGO
 * intent so NTT `release_inbound` deposits USDC into the ATA owned by
 * this PDA. `claim_usdc` re-derives + PDA-signs a sweep into the
 * relayer custody ATA.
 */
export function findUserInboxAuthorityPda(
  wallet: PublicKey,
  programId: PublicKey = RELAYER_PROGRAM_ID,
) {
  return PublicKey.findProgramAddressSync(
    [USER_INBOX_SEED, wallet.toBuffer()],
    programId,
  )
}

/**
 * `intent_transfer`'s singleton setter PDA. Deterministic — pinned by
 * the relayer as the only valid `NttManagerMessage.sender` for inbound
 * deposits.
 */
export function findIntentTransferSetterPda() {
  return PublicKey.findProgramAddressSync(
    [INTENT_TRANSFER_SETTER_SEED],
    INTENT_TRANSFER_PROGRAM_ID,
  )
}
