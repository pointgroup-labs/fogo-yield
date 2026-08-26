/**
 * The swap floor read back out of the user-signed intent, so the cranker no
 * longer needs the `onre:mso:<n>` memo — 53–56 transaction bytes that only
 * existed because v0.2 signed the inbox PDA instead of the number it derives
 * from.
 *
 * The two fixtures are real Fogo mainnet instructions, not constructions of
 * ours: agreement with the chain is the point, and a round-trip against our
 * own builder could not catch a wire-format drift.
 */

import type { Connection } from '@solana/web3.js'
import { Buffer } from 'node:buffer'
import {
  buildBridgeOutIntentMessage,
  buildIntentVerifierIx,
  buildMinSwapOutMemoIx,
  ed25519InlineMessages,
  MEMO_PROGRAM_ID,
  ONRE_INTENT_PROGRAM_ID,
  parseSignedMinOuts,
  recoverWalletAndMinOutCandidates,
} from '@ignitionfi/fogo-yield-sdk'
import { Ed25519Program, Keypair, PublicKey } from '@solana/web3.js'
import { describe, expect, it } from 'vitest'

/**
 * `AMUzFR3hw2YuAGaZXLobMVhPcwuzbsoWxYHWjRArid2m1SXpA4sx6eFqtAGtEaCa11ottYqjvA49vm3Avw2aKkB`
 * — the first Ledger-signed deposit, intent v0.3 inside an 85-byte SRFC-3
 * envelope, key pointed at the copy the envelope already carries.
 */
const V3_LEDGER_ED25519_IX = 'AQAQAP//gwD//1AAAAH//59li0I1dySvX6PvVGIZttUTm+pwV4HBe4S8cpvUdatxVaCP/HhRbkIyosOzx+lT7Xs7+3872kVvpu0ve5ClhAb/c29sYW5hIG9mZmNoYWluAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQEvNOSAFswE4my/4lDouPnkVMM9fizXiY3b6qsDHDIUV6sARm9nbyBCcmlkZ2UKCnZlcnNpb246IDAuMwpmcm9tX2NoYWluX2lkOiBmb2dvLW1haW5uZXQKdG9fY2hhaW5faWQ6IHNvbGFuYQp0b2tlbjogVVNEQy5zCmFtb3VudDogMS4wMDAwMDAKbWluX291dDogODY5Njk0OTA4CmZlZV90b2tlbjogVVNEQy5zCmZlZV9hbW91bnQ6IDIuMDAwMDAwCm5vbmNlOiAx'

/**
 * `4hqHy2iq1tCywzfbWUe7NLrHS612AJVEQmjiApNCg6H8B98ygMVmSeGy7yhXTRMo9VStxkzoHr1vjxQrdxKebE7w`
 * — a pre-v0.3 deposit: raw message, `recipient_address`, no floor to read.
 */
const V2_LEGACY_ED25519_IX = 'AQAwAP//EAD//3AA2QD//1mQ3ovKwrdPgHcRMShDLYD8B10nTYKgMNQfCzK8J7JNfzTeekyPjucjIdindsL43i4bEnW8EgaujXW7hZtCQbXuR8BKUQZ4bO0Gyzmjt4/ac49znZMXQPUVjfu6sA4HDUZvZ28gQnJpZGdlCgp2ZXJzaW9uOiAwLjIKZnJvbV9jaGFpbl9pZDogZm9nby1tYWlubmV0CnRvX2NoYWluX2lkOiBzb2xhbmEKdG9rZW46IFVTREMucwphbW91bnQ6IDEwLjAwMDAwMApyZWNpcGllbnRfYWRkcmVzczogSGFXeVVYUVpmSG1YN2lvUXFyZTNjdW4xNGV4eEdjZDNNcXlkanpWS3NieWYKZmVlX3Rva2VuOiBVU0RDLnMKZmVlX2Ftb3VudDogMi4wMDAwMDAKbm9uY2U6IDg='

const bytes = (b64: string) => new Uint8Array(Buffer.from(b64, 'base64'))

/** Floors stated by every message inlined in one Ed25519 precompile ix. */
const floorsIn = (ixData: Uint8Array) => ed25519InlineMessages(ixData).flatMap(parseSignedMinOuts)

const INTENT = {
  fromChainId: 'fogo-mainnet',
  toChainId: 'solana',
  tokenSymbolOrMint: 'USDC.s',
  amount: '5000.123333',
  feeTokenSymbolOrMint: 'USDC.s',
  feeAmount: '2.000000',
  nonce: 7n,
}

describe('parseSignedMinOuts on real mainnet instructions', () => {
  it('reads the floor out of a v0.3 intent signed inside an SRFC-3 envelope', () => {
    expect(floorsIn(bytes(V3_LEDGER_ED25519_IX))).toStrictEqual([869694908n])
  })

  it('agrees with the memo that rode in the same transaction', () => {
    const [fromIntent] = floorsIn(bytes(V3_LEDGER_ED25519_IX))
    const memo = buildMinSwapOutMemoIx(fromIntent).data
    expect(memo.toString('utf8')).toBe('onre:mso:869694908')
  })

  it('states no floor for a v0.2 intent, which is why the memo has to stay', () => {
    expect(floorsIn(bytes(V2_LEGACY_ED25519_IX))).toStrictEqual([])
  })
})

describe('parseSignedMinOuts against our own builder', () => {
  const signature = new Uint8Array(64).fill(7)

  it('round-trips the compact ix, where the key sits inside the message', () => {
    const wallet = Keypair.generate().publicKey
    // A hardware wallet's envelope embeds the signer, which is what lets
    // `buildIntentVerifierIx` drop its own 32-byte copy.
    const intent = buildBridgeOutIntentMessage({ ...INTENT, minOut: 4_350_000_000_000n })
    const enveloped = new Uint8Array(wallet.toBytes().length + intent.length)
    enveloped.set(wallet.toBytes())
    enveloped.set(intent, wallet.toBytes().length)

    const ix = buildIntentVerifierIx(wallet, signature, enveloped)
    expect(floorsIn(ix.data)).toStrictEqual([4_350_000_000_000n])
    // Falling back to the standard layout would still parse, so pin the saving:
    // header + signature + message only, key read from inside the message.
    expect(ix.data.length).toBe(16 + 64 + enveloped.length)
    const publicKeyOffset = new DataView(ix.data.buffer, ix.data.byteOffset).getUint16(6, true)
    expect(ix.data.subarray(publicKeyOffset, publicKeyOffset + 32)).toStrictEqual(Buffer.from(wallet.toBytes()))
  })

  it('round-trips the standard ix, where web3.js appends the key', () => {
    const wallet = Keypair.generate().publicKey
    const message = buildBridgeOutIntentMessage({ ...INTENT, minOut: 1n })
    const ix = buildIntentVerifierIx(wallet, signature, message)
    expect(floorsIn(ix.data)).toStrictEqual([1n])
    expect(ix.data.length).toBe(16 + 64 + 32 + message.length)
  })

  it('reads a u64::MAX floor and rejects the value above it', () => {
    const wallet = Keypair.generate().publicKey
    const max = (1n << 64n) - 1n
    const ok = buildIntentVerifierIx(wallet, signature, buildBridgeOutIntentMessage({ ...INTENT, minOut: max }))
    expect(floorsIn(ok.data)).toStrictEqual([max])

    const overflowed = new TextEncoder().encode(`version: 0.3\nmin_out: ${max + 1n}\nnonce: 1`)
    expect(parseSignedMinOuts(overflowed)).toStrictEqual([])
  })
})

describe('ed25519InlineMessages tolerates instructions that are not ours', () => {
  it('returns nothing for empty, truncated, or zero-signature data', () => {
    expect(ed25519InlineMessages(new Uint8Array())).toStrictEqual([])
    expect(ed25519InlineMessages(new Uint8Array([1, 0]))).toStrictEqual([])
    expect(ed25519InlineMessages(new Uint8Array(16))).toStrictEqual([])
  })

  it('skips an entry whose message lives in another instruction', () => {
    const ix = bytes(V3_LEDGER_ED25519_IX)
    new DataView(ix.buffer).setUint16(14, 0, true) // message_instruction_index := ix 0
    expect(ed25519InlineMessages(ix)).toStrictEqual([])
  })

  it('skips an entry whose message runs past the end of the data', () => {
    const ix = bytes(V3_LEDGER_ED25519_IX)
    new DataView(ix.buffer).setUint16(12, 0xFFF0, true) // message_data_size := beyond
    expect(ed25519InlineMessages(ix)).toStrictEqual([])
  })
})

const USER_WALLET = PublicKey.unique()
const SOURCE_ATA = PublicKey.unique()

/** SPL TokenAccount layout: mint(32) | owner(32) | … */
function sourceAtaData(owner: PublicKey): Buffer {
  const buf = Buffer.alloc(165)
  buf.set(owner.toBytes(), 32)
  return buf
}

/** FOGO bridge tx carrying the intent ix plus whatever floor sources are given. */
function mockConn(extra: { programIdIndex: number, data: Uint8Array }[]): Connection {
  const keys = [
    ONRE_INTENT_PROGRAM_ID,
    PublicKey.unique(),
    PublicKey.unique(),
    PublicKey.unique(),
    SOURCE_ATA,
    MEMO_PROGRAM_ID,
    Ed25519Program.programId,
  ]
  const compiledInstructions = [
    { programIdIndex: 0, accountKeyIndexes: [1, 2, 3, 4], data: new Uint8Array() },
    ...extra.map(e => ({ ...e, accountKeyIndexes: [] })),
  ]
  return {
    getTransaction: async () => ({
      meta: { loadedAddresses: undefined },
      transaction: { message: { getAccountKeys: () => ({ get: (i: number) => keys[i] }), compiledInstructions } },
    }),
    getAccountInfo: async (pk: PublicKey) => (pk.equals(SOURCE_ATA) ? { data: sourceAtaData(USER_WALLET) } : null),
  } as unknown as Connection
}

const MEMO_IX = { programIdIndex: 5, data: buildMinSwapOutMemoIx(869694908n).data }
const INTENT_IX = { programIdIndex: 6, data: bytes(V3_LEDGER_ED25519_IX) }

describe('recoverWalletAndMinOutCandidates', () => {
  it('recovers the floor from a tx that carries no memo at all', async () => {
    const out = await recoverWalletAndMinOutCandidates(mockConn([INTENT_IX]), 'sig')
    expect(out).toHaveLength(1)
    expect(out[0].userWallet.equals(USER_WALLET)).toBe(true)
    expect(out[0].minSwapOut).toBe(869694908n)
  })

  it('still recovers from a memo-only tx, so deposits in flight keep landing', async () => {
    const out = await recoverWalletAndMinOutCandidates(mockConn([MEMO_IX]), 'sig')
    expect(out.map(c => c.minSwapOut)).toStrictEqual([869694908n])
  })

  it('does not double-count when both sources state the same floor', async () => {
    const out = await recoverWalletAndMinOutCandidates(mockConn([MEMO_IX, INTENT_IX]), 'sig')
    expect(out.map(c => c.minSwapOut)).toStrictEqual([869694908n])
  })

  it('offers both when they disagree — the VAA recipient PDA picks the winner', async () => {
    const decoy = { programIdIndex: 5, data: buildMinSwapOutMemoIx(1n).data }
    const out = await recoverWalletAndMinOutCandidates(mockConn([decoy, INTENT_IX]), 'sig')
    expect(out.map(c => c.minSwapOut).sort()).toStrictEqual([1n, 869694908n])
  })
})
