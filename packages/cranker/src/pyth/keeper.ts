import type { Connection, Keypair, PublicKey, Transaction, VersionedTransaction } from '@solana/web3.js'
import { decodePriceUpdate, getPythPriceFeedAccount } from '@ignitionfi/fogo-yield-sdk'

/**
 * ONyc NAV Pyth keeper for FOGO.
 *
 * OnRe publishes the ONyc NAV as a Pyth "Crypto NAV" feed. The Pyth receiver
 * (`rec5…`) and its wormhole guardian-verifier (`HDwc…`) are deployed on FOGO,
 * but no one posts this feed there — so its sponsored price account doesn't
 * exist on FOGO yet. This keeper closes that gap: it fetches the signed update
 * from Hermes and posts it to FOGO's receiver, keeping the on-chain NAV fresh so
 * FOGO programs (and the webapp) can read it natively without a Solana RPC hop.
 *
 * Self-throttling: reads the on-chain account first and only posts when the
 * price is missing or older than `maxAgeMs`, so it's cheap to call periodically.
 * Gated OFF by default (`PYTH_KEEPER_ENABLED`).
 */

export interface PythNavKeeperArgs {
  fogoConnection: Connection
  keypair: Keypair
  hermesUrl: string
  feedId: string
  shardId: number
  /** Re-post only when the on-chain price is missing or older than this. */
  maxAgeMs: number
  priorityFeeMicroLamports: number
  log: (event: string, fields?: Record<string, unknown>) => void
  signal: AbortSignal
}

type KeeperResult = 'posted' | 'fresh' | 'error'

/** True when FOGO's sponsored price account is present and within `maxAgeMs`. */
export async function isFresh(args: PythNavKeeperArgs, priceAccount: PublicKey): Promise<boolean> {
  const info = await args.fogoConnection.getAccountInfo(priceAccount, 'confirmed')
  if (!info) {
    return false
  }
  const decoded = decodePriceUpdate(info.data, args.feedId)
  return decoded != null && Date.now() - decoded.publishTime * 1000 < args.maxAgeMs
}

/** Fetch the signed (VAA-bearing) price update(s) from Hermes, base64-encoded. */
async function fetchSignedUpdate(hermesUrl: string, feedId: string): Promise<string[]> {
  const res = await fetch(`${hermesUrl}/v2/updates/price/latest?ids[]=${feedId}&encoding=base64`)
  if (!res.ok) {
    throw new Error(`Pyth Hermes returned ${res.status}`)
  }
  const json = await res.json() as { binary?: { data?: string[] } }
  const data = json.binary?.data
  if (!data?.length) {
    throw new Error('Pyth Hermes: no signed update data')
  }
  return data
}

type ReceiverWallet = ConstructorParameters<
  typeof import('@pythnetwork/pyth-solana-receiver').PythSolanaReceiver
>[0]['wallet']

/** Minimal anchor-style wallet over the keeper keypair; signs legacy + versioned txs. */
export function keypairWallet(keypair: Keypair): ReceiverWallet {
  const sign = (tx: Transaction | VersionedTransaction): Transaction | VersionedTransaction => {
    if ('version' in tx) {
      tx.sign([keypair])
    } else {
      tx.partialSign(keypair)
    }
    return tx
  }
  return {
    publicKey: keypair.publicKey,
    signTransaction: (tx: Transaction | VersionedTransaction) => Promise.resolve(sign(tx)),
    signAllTransactions: (txs: (Transaction | VersionedTransaction)[]) => Promise.resolve(txs.map(sign)),
  } as unknown as ReceiverWallet
}

/**
 * Post the signed update to FOGO's Pyth receiver as a persistent sponsored feed
 * account. The receiver/wormhole/push-oracle program ids match Solana, so the
 * default receiver config works once pointed at the FOGO connection.
 */
async function postSignedUpdateToFogo(args: PythNavKeeperArgs, signedUpdate: string[]): Promise<number> {
  const { PythSolanaReceiver } = await import('@pythnetwork/pyth-solana-receiver')
  const receiver = new PythSolanaReceiver({
    connection: args.fogoConnection,
    wallet: keypairWallet(args.keypair),
  })
  const builder = receiver.newTransactionBuilder({ closeUpdateAccounts: false })
  await builder.addUpdatePriceFeed(signedUpdate, args.shardId)
  const txs = await builder.buildVersionedTransactions({
    computeUnitPriceMicroLamports: args.priorityFeeMicroLamports,
  })
  await receiver.provider.sendAll(txs)
  return txs.length
}

/** Post the latest ONyc NAV to FOGO's Pyth receiver if it's stale or missing. */
async function runOnce(args: PythNavKeeperArgs, priceAccount: PublicKey): Promise<KeeperResult> {
  try {
    if (await isFresh(args, priceAccount)) {
      return 'fresh'
    }
    const signedUpdate = await fetchSignedUpdate(args.hermesUrl, args.feedId)
    const txCount = await postSignedUpdateToFogo(args, signedUpdate)
    args.log('pyth-keeper.posted', { feedId: args.feedId, txs: txCount })
    return 'posted'
  } catch (err) {
    args.log('pyth-keeper.error', { feedId: args.feedId, error: err instanceof Error ? err.message : String(err) })
    return 'error'
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve()
      return
    }
    let timer: ReturnType<typeof setTimeout>
    const onAbort = (): void => {
      clearTimeout(timer)
      resolve()
    }
    timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    timer.unref()
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * Fire-and-forget periodic keeper. Checks (and posts if stale) every ~half the
 * freshness window, so the on-chain price stays within `maxAgeMs`. Fully
 * independent of the bridge/flow scan legs.
 */
export function startPythNavKeeper(args: PythNavKeeperArgs): void {
  const priceAccount = getPythPriceFeedAccount(args.feedId, args.shardId)
  const checkIntervalMs = Math.max(30_000, Math.floor(args.maxAgeMs / 2))
  void (async () => {
    while (!args.signal.aborted) {
      await runOnce(args, priceAccount)
      await sleep(checkIntervalMs, args.signal)
    }
  })()
}
