import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { AnchorProvider, Wallet } from '@anchor-lang/core'
import { RelayerClient } from '@fogo-onre/sdk'
import {
  Cluster,
  clusterApiUrl,
  Connection,
  Keypair,
  SendTransactionError,
} from '@solana/web3.js'

export interface Context {
  connection: Connection
  keypair: Keypair
  provider: AnchorProvider
  client: RelayerClient
}

let ctx: Context

export function useContext(): Context {
  if (!ctx) {
    throw new Error('CLI context not initialized')
  }
  return ctx
}

const VALID_CLUSTERS = new Set<string>(['mainnet-beta', 'testnet', 'devnet'])

const PROGRAM_ERROR_RE = /custom program error: 0x([0-9a-f]+)/i

export function initContext(opts: {
  url?: string
  keypair?: string
  readOnly?: boolean
}): Context {
  const connection = new Connection(resolveRpcUrl(opts.url), 'confirmed')
  const keypair = opts.readOnly ? Keypair.generate() : resolveKeypair(opts.keypair)
  const wallet = new Wallet(keypair)
  const provider = new AnchorProvider(connection, wallet, { commitment: 'confirmed' })
  const client = new RelayerClient(provider)
  ctx = { connection, keypair, provider, client }
  return ctx
}

/**
 * Wraps an `async () => Promise<string>` (typically `client.foo({...}).rpc()`),
 * surfaces program-error codes in hex, and rethrows a clean Error.
 */
export async function runTx(send: () => Promise<string>): Promise<string> {
  try {
    return await send()
  }
  catch (err) {
    throw formatTxError(err)
  }
}

function resolveRpcUrl(url?: string): string {
  if (!url) {
    return clusterApiUrl('mainnet-beta')
  }
  if (url.startsWith('http')) {
    return url
  }
  if (!VALID_CLUSTERS.has(url)) {
    throw new Error(
      `Unknown cluster "${url}". Use: mainnet-beta, testnet, devnet, or an HTTP(S) URL`,
    )
  }
  return clusterApiUrl(url as Cluster)
}

function resolveKeypair(path?: string): Keypair {
  const file = path
    ?? process.env.SOLANA_KEYPAIR
    ?? join(homedir(), '.config', 'solana', 'id.json')

  const raw = readFileSync(file, 'utf-8')
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)))
}

function formatTxError(err: unknown): Error {
  if (err instanceof SendTransactionError) {
    const match = err.message.match(PROGRAM_ERROR_RE)
    if (match) {
      const code = Number.parseInt(match[1], 16)
      return new Error(`Transaction failed: program error 0x${match[1]} (${code})`)
    }
  }
  return err instanceof Error ? err : new Error(String(err))
}
