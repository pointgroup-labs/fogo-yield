import type { AccountInfo, Commitment, Connection, PublicKey } from '@solana/web3.js'

/** Solana's `getMultipleAccounts` caps at 100 keys per request. */
const MAX_KEYS_PER_CALL = 100

export interface GetMultipleAccountsChunkedOptions {
  /** Keys per RPC call. Clamped to Solana's 100-key ceiling. */
  chunkSize?: number
  commitment?: Commitment
}

/**
 * Fetch many accounts in the fewest round-trips: chunks `pubkeys` into
 * ≤100-key `getMultipleAccountsInfo` calls and concatenates the results in
 * input order. Missing accounts stay `null`, exactly as the RPC returns
 * them. Chunks run sequentially so a large key set can't itself burst the
 * rate limit — pair with a rate-limited connection for the concurrency cap.
 */
export async function getMultipleAccountsChunked(
  connection: Connection,
  pubkeys: PublicKey[],
  opts: GetMultipleAccountsChunkedOptions = {},
): Promise<(AccountInfo<Buffer> | null)[]> {
  if (pubkeys.length === 0) {
    return []
  }
  const chunkSize = Math.max(1, Math.min(opts.chunkSize ?? MAX_KEYS_PER_CALL, MAX_KEYS_PER_CALL))
  const out: (AccountInfo<Buffer> | null)[] = []
  for (let i = 0; i < pubkeys.length; i += chunkSize) {
    const infos = await connection.getMultipleAccountsInfo(pubkeys.slice(i, i + chunkSize), opts.commitment)
    for (const info of infos) {
      out.push(info)
    }
  }
  return out
}
