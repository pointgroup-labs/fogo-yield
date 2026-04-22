/**
 * Load mainnet account JSON fixtures into LiteSVM.
 *
 * Each JSON file in `tests/fixtures/accounts/` has the shape:
 * ```json
 * {
 *   "account": {
 *     "data": ["<base64>", "base64"],
 *     "executable": false,
 *     "lamports": 12345,
 *     "owner": "<base58 pubkey>",
 *     "rentEpoch": 18446744073709551615,
 *     "space": 123
 *   },
 *   "pubkey": "<base58 pubkey>"
 * }
 * ```
 */

import type { LiteSVM } from 'litesvm'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PublicKey } from '@solana/web3.js'

const FIXTURES_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../fixtures/accounts',
)

interface FixtureJson {
  account: {
    data: [string, string] // [base64_data, "base64"]
    executable: boolean
    lamports: number
    owner: string
    rentEpoch: number
    space?: number
  }
  pubkey: string
}

/**
 * Load a single fixture JSON file into LiteSVM by pubkey address.
 * Returns the pubkey for chaining.
 */
export function loadFixture(svm: LiteSVM, address: string): PublicKey {
  const filePath = path.join(FIXTURES_DIR, `${address}.json`)
  const json: FixtureJson = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
  const data = Buffer.from(json.account.data[0], 'base64')
  const pubkey = new PublicKey(json.pubkey)

  svm.setAccount(pubkey, {
    executable: json.account.executable,
    owner: new PublicKey(json.account.owner),
    lamports: json.account.lamports,
    data: new Uint8Array(data),
    rentEpoch: 0,
  })

  return pubkey
}

/**
 * Load multiple fixture files into LiteSVM.
 * Returns a map of address string -> PublicKey.
 */
export function loadFixtures(svm: LiteSVM, addresses: string[]): Map<string, PublicKey> {
  const result = new Map<string, PublicKey>()
  for (const addr of addresses) {
    result.set(addr, loadFixture(svm, addr))
  }
  return result
}

/**
 * Load ALL fixture files from the accounts directory.
 */
export function loadAllFixtures(svm: LiteSVM): Map<string, PublicKey> {
  const files = fs.readdirSync(FIXTURES_DIR).filter(f => f.endsWith('.json'))
  const addresses = files.map(f => path.basename(f, '.json'))
  return loadFixtures(svm, addresses)
}

/**
 * Read the raw account-data bytes from a fixture file WITHOUT injecting it
 * into LiteSVM. Used when the caller needs to patch the bytes (mint pubkeys,
 * pricing fields, etc.) before placing them under a different PDA than the
 * fixture's original pubkey — e.g. derived from test mints.
 */
export function readFixtureBytes(address: string): Uint8Array {
  const filePath = path.join(FIXTURES_DIR, `${address}.json`)
  const json: FixtureJson = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
  return new Uint8Array(Buffer.from(json.account.data[0], 'base64'))
}
