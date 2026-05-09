import type { QueryClient } from '@tanstack/react-query'
import type { BurnRow, OperationStatus, TimelineRow } from './types'
import type { PersistedFlowStatus } from '@/lib/flow-status/types'
import { USDC_S_MINT } from '@/constants'
import { readFlow, readIndex } from '@/lib/flow-status/store'
import { isTerminal } from '@/lib/flow-status/types'

/**
 * Find the journal entry for a given burn signature, if any. Journal
 * entries are keyed on `flowId`, not signature, so this is an O(N)
 * scan of the index — N is small (≤ a handful of in-flight flows in
 * normal use), so the linear scan is fine.
 *
 * Only returns non-terminal entries — terminal flows are already
 * reflected in the Wormholescan `delivered` status, and their journal
 * `phase` would shadow the badge unhelpfully.
 */
export function findJournalEntryBySignature(
  qc: QueryClient,
  signature: string,
): PersistedFlowStatus | null {
  const ids = readIndex(qc)
  for (const id of ids) {
    const entry = readFlow(qc, id)
    if (entry !== undefined && entry.signature === signature && !isTerminal(entry.status)) {
      return entry
    }
  }
  return null
}

/**
 * Pure: given the three inputs, produce one TimelineRow. Must be
 * deterministic — same inputs always yield the same output.
 */
export function mergeRow(
  burn: BurnRow,
  op: OperationStatus | null,
  journal: PersistedFlowStatus | null,
): TimelineRow {
  return {
    signature: burn.signature,
    // The user's burn mint determines the flow direction. Burning
    // USDC.s on FOGO = depositing into the protocol. Burning ONyc
    // on FOGO = withdrawing.
    kind: burn.mint.equals(USDC_S_MINT) ? 'deposit' : 'withdraw',
    amountRaw: burn.amountRaw,
    mintB58: burn.mint.toBase58(),
    blockTime: burn.blockTime,
    status: op?.kind ?? 'unknown',
    destinationSignature: op !== null && op.kind === 'delivered' ? op.destinationTxHash : null,
    phase: journal !== null ? humanPhaseFromStatus(journal) : null,
  }
}

/**
 * The journal stores `FlowStatusValue` ('pending' | 'in-progress' | …).
 * `BridgeHistory` wants a human label like "Bridging…" / "Submitting".
 * Keep the mapping here so the component stays presentational.
 */
function humanPhaseFromStatus(j: PersistedFlowStatus): string {
  switch (j.status) {
    case 'pending':
      return 'Submitting'
    case 'in-progress':
      return 'Bridging'
    case 'terminal-success':
      return 'Complete'
    case 'terminal-failure':
      return 'Failed'
  }
}
