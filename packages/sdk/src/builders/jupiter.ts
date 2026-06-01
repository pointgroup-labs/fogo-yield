import type { AccountMeta } from '@solana/web3.js'
import { Buffer } from 'node:buffer'
import { PublicKey } from '@solana/web3.js'

// Jupiter deprecated `quote-api.jup.ag/v6` in favor of host-prefixed
// `swap/v1` endpoints: `lite-api.jup.ag` (free, rate-limited) and
// `api.jup.ag` (keyed). Override via `JUPITER_API_BASE` for self-hosted
// or paid deployments. Response shapes are wire-compatible with v6 for
// the fields this builder reads (`swapInstruction`, ALT list).
const JUP_API_BASE = (typeof process !== 'undefined' && process.env?.JUPITER_API_BASE)
  || 'https://lite-api.jup.ag'
const JUP_QUOTE = `${JUP_API_BASE}/swap/v1/quote`
const JUP_SWAP_IX = `${JUP_API_BASE}/swap/v1/swap-instructions`

export const JUPITER_V6_PROGRAM_ID = new PublicKey(
  'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
)

/**
 * Anchor discriminator for Jupiter v6 `shared_accounts_route` —
 * `sha256("global:shared_accounts_route")[..8]`. Mirrors the on-chain
 * `SHARED_ACCOUNTS_ROUTE_IX` constant in `programs/relayer/src/jupiter.rs`.
 * Used here so the SDK rejects non-`shared_accounts_route` variants
 * before the recovery script broadcasts a tx that would only fail
 * on-chain with `JupiterIxDiscriminatorMismatch`.
 */
const SHARED_ACCOUNTS_ROUTE_DISCRIMINATOR = Uint8Array.from([
  193, 32, 155, 51, 65, 214, 156, 129,
])

export interface JupiterRouteParams {
  inputMint: PublicKey
  outputMint: PublicKey
  amount: bigint
  /** Caller's outer slippage budget. The on-chain handler enforces a 0.5% absolute floor. */
  slippageBps: number
  /** PDA that signs the Jupiter CPI on-chain (= relayer_authority). */
  userPublicKey: PublicKey
  /** Optional override (mainnet RPC defaults inside Jupiter's API). */
  fetchImpl?: typeof fetch
  onlyDirectRoutes?: boolean
}

export interface JupiterRouteResult {
  /** `shared_accounts_route` instruction data (with discriminator). */
  ixData: Uint8Array
  /** Account list ordered by Jupiter's IDL — pass directly as `remainingAccounts`. */
  routeAccounts: AccountMeta[]
  /** Quoted output amount, before slippage haircut. */
  quotedOutAmount: bigint
  /** Address-lookup-table public keys returned by Jupiter (use to fit a v0 tx). */
  addressLookupTables: PublicKey[]
  /**
   * Jupiter v6 program id. Always `JUPITER_V6_PROGRAM_ID` (validated above)
   * — surfaced so the router-agnostic `swap` handler can be
   * fed the right `swap_program` without the caller knowing it's Jupiter.
   */
  programId: PublicKey
  /**
   * Jupiter's `programAuthority` PDA — the SPL delegate that the on-chain
   * Approve in `swap` is bounded to. Taken from account index
   * 1 of `shared_accounts_route` (the IDL's `programAuthority` slot).
   */
  swapDelegate: PublicKey
}

/**
 * Fetch a fresh Jupiter v6 `shared_accounts_route` quote + ix-account list.
 *
 * Calls Jupiter's hosted REST API, requests `useSharedAccounts: true` to
 * pin the variant the on-chain handler authenticates. Throws if Jupiter
 * returns a different variant — defense against API drift.
 */
export async function fetchJupiterRoute(p: JupiterRouteParams): Promise<JupiterRouteResult> {
  const fetchImpl = p.fetchImpl ?? fetch
  const q = new URL(JUP_QUOTE)
  q.searchParams.set('inputMint', p.inputMint.toBase58())
  q.searchParams.set('outputMint', p.outputMint.toBase58())
  q.searchParams.set('amount', p.amount.toString())
  q.searchParams.set('slippageBps', String(p.slippageBps))
  q.searchParams.set('platformFeeBps', '0')
  q.searchParams.set('onlyDirectRoutes', String(p.onlyDirectRoutes ?? false))

  const quoteResp = await fetchImpl(q.toString())
  if (!quoteResp.ok) {
    throw new Error(`Jupiter /quote returned ${quoteResp.status}: ${await quoteResp.text()}`)
  }
  const quote = await quoteResp.json() as Record<string, unknown>

  const swapResp = await fetchImpl(JUP_SWAP_IX, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey: p.userPublicKey.toBase58(),
      useSharedAccounts: true,
      wrapAndUnwrapSol: false,
    }),
  })
  if (!swapResp.ok) {
    throw new Error(`Jupiter /swap-instructions returned ${swapResp.status}: ${await swapResp.text()}`)
  }
  const swap = await swapResp.json() as {
    swapInstruction?: { programId: string, accounts: Array<{ pubkey: string, isSigner: boolean, isWritable: boolean }>, data: string }
    addressLookupTableAddresses?: string[]
  }
  if (!swap.swapInstruction) {
    throw new Error('Jupiter did not return a swapInstruction (shared_accounts_route)')
  }
  if (swap.swapInstruction.programId !== JUPITER_V6_PROGRAM_ID.toBase58()) {
    throw new Error(`Jupiter returned an unexpected program id: ${swap.swapInstruction.programId}`)
  }

  const ixData = Uint8Array.from(Buffer.from(swap.swapInstruction.data, 'base64'))
  // Reject non-`shared_accounts_route` variants here. The on-chain
  // handler authenticates this same discriminator, but checking in the
  // SDK avoids broadcasting a tx that would deterministically fail
  // with `JupiterIxDiscriminatorMismatch` after a successful dry-run.
  if (ixData.length < SHARED_ACCOUNTS_ROUTE_DISCRIMINATOR.length) {
    throw new Error(`Jupiter swapInstruction data too short (${ixData.length} bytes)`)
  }
  for (let i = 0; i < SHARED_ACCOUNTS_ROUTE_DISCRIMINATOR.length; i++) {
    if (ixData[i] !== SHARED_ACCOUNTS_ROUTE_DISCRIMINATOR[i]) {
      throw new Error(
        'Jupiter returned a non-`shared_accounts_route` variant despite useSharedAccounts: true',
      )
    }
  }

  const routeAccounts = swap.swapInstruction.accounts.map((a) => {
    const pubkey = new PublicKey(a.pubkey)
    return {
      pubkey,
      isSigner: a.isSigner && !pubkey.equals(p.userPublicKey),
      isWritable: a.isWritable,
    }
  })

  return {
    ixData,
    // Sanitize signer bits before handing to the outer relayer ix:
    // Jupiter marks `user_transfer_authority` (= our `relayerAuthorityPda`)
    // as `isSigner: true`, but that PDA cannot sign at the transaction
    // level. The outer handler uses plain `invoke` (not `invoke_signed`)
    // anyway, so leaving the bit on would just make tx build fail. Clear
    // the bit on the meta whose pubkey == userPublicKey.
    routeAccounts,
    quotedOutAmount: BigInt((quote as { outAmount: string }).outAmount),
    addressLookupTables: (swap.addressLookupTableAddresses ?? []).map(s => new PublicKey(s)),
    programId: JUPITER_V6_PROGRAM_ID,
    // Account index 1 in Jupiter v6 `shared_accounts_route` is the
    // `programAuthority` PDA — the SPL delegate that pulls ONyc out of
    // the relayer's ATA. `swap` bounds its Approve to
    // exactly this key for exactly `net_onyc`.
    swapDelegate: routeAccounts[1].pubkey,
  }
}
