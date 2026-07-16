import type { Transaction, VersionedTransaction } from '@solana/web3.js'
import type { PythNavKeeperArgs } from '../src/pyth/keeper'
import { Buffer } from 'node:buffer'
import { Keypair, PublicKey } from '@solana/web3.js'
import { describe, expect, it, vi } from 'vitest'
import { isFresh, keypairWallet } from '../src/pyth/keeper'

const FEED = 'babbfcc7f46b6e7df73adcccece8b6782408ed27c4e77f35ba39a449440170ab'
const ACCOUNT = new PublicKey('8uto8utKdfs2ajrmBtcFL5s9mXbc7UPg8HSdLwCn1Mg7')

function priceUpdateAt(publishTimeS: number): Buffer {
  const prefix = 11
  const buf = Buffer.alloc(prefix + 60)
  Buffer.from(FEED, 'hex').copy(buf, prefix)
  buf.writeBigInt64LE(107_000_000n, prefix + 32)
  buf.writeInt32LE(-8, prefix + 48)
  buf.writeBigInt64LE(BigInt(publishTimeS), prefix + 52)
  return buf
}

function argsWith(account: { data: Uint8Array } | null): PythNavKeeperArgs {
  return {
    fogoConnection: { getAccountInfo: vi.fn().mockResolvedValue(account) },
    feedId: FEED,
    maxAgeMs: 60_000,
  } as unknown as PythNavKeeperArgs
}

describe('keypairWallet', () => {
  it('exposes the keypair public key', () => {
    const kp = Keypair.generate()
    expect(keypairWallet(kp).publicKey.equals(kp.publicKey)).toBe(true)
  })

  it('signs versioned txs via sign() and legacy txs via partialSign()', async () => {
    const kp = Keypair.generate()
    const wallet = keypairWallet(kp)
    const versioned = { version: 0, sign: vi.fn() }
    const legacy = { partialSign: vi.fn() }
    await wallet.signTransaction(versioned as unknown as VersionedTransaction)
    await wallet.signTransaction(legacy as unknown as Transaction)
    expect(versioned.sign).toHaveBeenCalledWith([kp])
    expect(legacy.partialSign).toHaveBeenCalledWith(kp)
  })
})

describe('isFresh', () => {
  it('is false when the sponsored account is missing', async () => {
    expect(await isFresh(argsWith(null), ACCOUNT)).toBe(false)
  })

  it('is false when the feed id is absent from the account data', async () => {
    expect(await isFresh(argsWith({ data: Buffer.alloc(80) }), ACCOUNT)).toBe(false)
  })

  it('is true for a publish time within maxAgeMs', async () => {
    const nowS = Math.floor(Date.now() / 1000)
    expect(await isFresh(argsWith({ data: priceUpdateAt(nowS) }), ACCOUNT)).toBe(true)
  })

  it('is false for a stale publish time', async () => {
    const staleS = Math.floor(Date.now() / 1000) - 3600
    expect(await isFresh(argsWith({ data: priceUpdateAt(staleS) }), ACCOUNT)).toBe(false)
  })
})
