import type { OperationStatus } from './types'
import { z } from 'zod'

const WORMHOLESCAN_BASE = 'https://api.wormholescan.io/api/v1'
const REQUEST_TIMEOUT_MS = 3000

const OperationSchema = z.object({
  sourceChain: z.object({
    transaction: z.object({ txHash: z.string() }),
  }),
  targetChain: z
    .object({
      transaction: z.object({ txHash: z.string() }).optional(),
      status: z.string().optional(),
    })
    .optional(),
})

const ResponseSchema = z.object({
  operations: z.array(OperationSchema).optional(),
})

export async function fetchOperationStatus(sourceTxHash: string): Promise<OperationStatus> {
  const url = `${WORMHOLESCAN_BASE}/operations?txHash=${encodeURIComponent(sourceTxHash)}&pageSize=1`

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
    if (!res.ok) {
      return { kind: 'unknown' }
    }
    const json: unknown = await res.json()
    const parsed = ResponseSchema.safeParse(json)
    if (!parsed.success) {
      return { kind: 'unknown' }
    }
    const op = parsed.data.operations?.[0]
    if (op === undefined) {
      return { kind: 'unknown' }
    }
    const destTx = op.targetChain?.transaction?.txHash
    if (destTx !== undefined) {
      return { kind: 'delivered', destinationTxHash: destTx }
    }
    return { kind: 'pending' }
  } catch {
    return { kind: 'unknown' }
  }
}
