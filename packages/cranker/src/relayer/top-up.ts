import type { Connection, PublicKey } from '@solana/web3.js'
import { SystemProgram } from '@solana/web3.js'

// NTT charges OutboxItem rent (~1,858,320 lamports) from `relayer_authority`
// via invoke_signed; target debit + rent-exempt + headroom = 3M.
export const RELAYER_AUTH_TOPUP = 3_000_000n
// session_authority is signer-only; 2M leaves it well above rent-exempt.
export const SESSION_AUTH_TOPUP = 2_000_000n

/** Lamports needed to bring `existing` up to `target` (0 if already at/above). */
export function computeTopUp(existing: number | undefined, target: bigint): bigint {
  const e = BigInt(existing ?? 0)
  return e >= target ? 0n : target - e
}

/**
 * Build the SystemProgram.transfer ixs that top relayer_authority and
 * session_authority up to their rent thresholds for an outbound NTT
 * transfer_lock. Shared by the `send` and `refund` legs.
 */
export async function buildTopUpIxs(args: {
  connection: Connection
  payer: PublicKey
  relayerAuthorityPda: PublicKey
  sessionAuthorityPda: PublicKey
}): Promise<ReturnType<typeof SystemProgram.transfer>[]> {
  const [relayerAuthInfo, sessionAuthInfo] = await Promise.all([
    args.connection.getAccountInfo(args.relayerAuthorityPda).catch(() => null),
    args.connection.getAccountInfo(args.sessionAuthorityPda).catch(() => null),
  ])
  const relayerTopUp = computeTopUp(relayerAuthInfo?.lamports, RELAYER_AUTH_TOPUP)
  const sessionTopUp = computeTopUp(sessionAuthInfo?.lamports, SESSION_AUTH_TOPUP)
  const fundIxs: ReturnType<typeof SystemProgram.transfer>[] = []
  if (relayerTopUp > 0n) {
    fundIxs.push(SystemProgram.transfer({ fromPubkey: args.payer, toPubkey: args.relayerAuthorityPda, lamports: Number(relayerTopUp) }))
  }
  if (sessionTopUp > 0n) {
    fundIxs.push(SystemProgram.transfer({ fromPubkey: args.payer, toPubkey: args.sessionAuthorityPda, lamports: Number(sessionTopUp) }))
  }
  return fundIxs
}
