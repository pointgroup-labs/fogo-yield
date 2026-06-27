import type { RelayerClient } from '@fogo-yield/sdk'
import type { PublicKey } from '@solana/web3.js'

type Flow = Awaited<ReturnType<RelayerClient['fetchInflightFlow']>>

/** Decode the Flow PDA for `nttInboxItem` on the leg `direction` selects, or null if absent. */
export async function fetchFlowFor(
  client: RelayerClient,
  direction: 'deposit' | 'withdraw',
  nttInboxItem: PublicKey,
): Promise<Flow | null> {
  const fetch = direction === 'deposit'
    ? client.fetchInflightFlow(nttInboxItem)
    : client.fetchOutflightFlow(nttInboxItem)
  return fetch.catch(() => null)
}
