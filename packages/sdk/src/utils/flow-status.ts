import type { PublicKey } from '@solana/web3.js'

/** Anchor-decoded BN-like field (avoids importing the BN type). */
type BnLike = { toString: () => string }

/**
 * Shape of a `Flow` account fetched via `RelayerClient.fetchFlow` /
 * `fetchInflightFlow` / `fetchOutflightFlow`. Mirrors the on-chain `Flow`
 * (programs/relayer/src/state.rs). The `status` and `direction` fields are the
 * Anchor enum representation: exactly one variant key is present, mapped to an
 * empty object.
 */
export interface FlowAccount {
  recipient: PublicKey
  status: { received?: object, swapped?: object }
  amount: BnLike
  payer: PublicKey
  bump: number
  direction: { deposit?: object, withdraw?: object }
  minSwapOut: BnLike
  receivedSlot: BnLike
}

export type FlowStatusName = 'Received' | 'Swapped' | 'Unknown'

/** Stringify the Anchor enum status into a readable label. */
export function describeStatus(status: FlowAccount['status']): FlowStatusName {
  if (status.received !== undefined) {
    return 'Received'
  }
  if (status.swapped !== undefined) {
    return 'Swapped'
  }
  return 'Unknown'
}
