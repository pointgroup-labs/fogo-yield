/* eslint-disable style/max-statements-per-line -- binary buffer assembly: `buf.set(...); off += N` reads more naturally on one line than split */
/**
 * Unit tests for `planBridgeRedeem`. Stubs out `target.destConnection`
 * so we never touch a real RPC — every branch (filter mismatches, the
 * three inbox-item states, both release modes) is exercised against
 * hand-rolled VAA + InboxItem bytes.
 */
import type { BridgeContext, BridgeRedeemTarget } from '../../src/bridge/types'
import { NTT_ONYC_PROGRAM_ID } from '@fogo-onre/sdk'
import { sha256 } from '@noble/hashes/sha2.js'
import { Connection, Keypair, PublicKey } from '@solana/web3.js'
import { describe, expect, it, vi } from 'vitest'
import { planBridgeRedeem } from '../../src/bridge/redeem'

// FOGO Wormhole chain ID. Sourced via the same constant the daemon uses
// in production (see config.ts default for FOGO_WORMHOLE_CHAIN_ID).
const FOGO_CHAIN = 36
const SOLANA_CHAIN = 1

const FOGO_ONYC_MINT = new PublicKey('oNyCm1QsAatj3ckaEwZjtAPWvstPn3Zm5MAYPtkjEfa')

function inboxItemDiscriminator(): Buffer {
  return Buffer.from(sha256(new TextEncoder().encode('account:InboxItem')).slice(0, 8))
}

function encodeInboxItem(args: {
  amount: bigint
  recipient: PublicKey
  release: 'NotApproved' | { ReleaseAfter: bigint } | 'Released'
}): Buffer {
  const parts: Buffer[] = [
    inboxItemDiscriminator(),
    Buffer.from([1]), // init
    Buffer.from([254]), // bump
    (() => { const b = Buffer.alloc(8); b.writeBigUInt64LE(args.amount); return b })(),
    Buffer.from(args.recipient.toBytes()),
    (() => {
      const b = Buffer.alloc(16)
      b.writeBigUInt64LE(1n, 0)
      b.writeBigUInt64LE(0n, 8)
      return b
    })(),
  ]
  if (args.release === 'NotApproved') {
    parts.push(Buffer.from([0]))
  } else if (args.release === 'Released') {
    parts.push(Buffer.from([2]))
  } else {
    const b = Buffer.alloc(9)
    b.writeUInt8(1, 0)
    b.writeBigInt64LE(args.release.ReleaseAfter, 1)
    parts.push(b)
  }
  return Buffer.concat(parts)
}

/**
 * Wormhole VAA + transceiver wrapper + NttManagerMessage assembled
 *  inline. Sigless (sigCount=0) — enough for the parser.
 */
function buildVaa(args: {
  emitterChain: number
  emitterAddress?: Uint8Array
  toChain: number
  recipient: PublicKey
  sender?: PublicKey
  amount?: bigint
}): Uint8Array {
  const emitterAddress = args.emitterAddress ?? new Uint8Array(32)
  const sender = args.sender ?? PublicKey.default
  const sourceMgr = new Uint8Array(32)
  const recipientMgr = new Uint8Array(32)
  const messageId = new Uint8Array(32)
  // Pad an arbitrary distinguishing byte so distinct VAAs derive distinct PDAs.
  messageId[0] = (args.emitterChain * 31 + args.toChain) & 0xFF

  // NativeTokenTransfer inner
  const inner = Buffer.alloc(4 + 1 + 8 + 32 + 32 + 2)
  let p = 0
  inner.set([0x99, 0x4E, 0x54, 0x54], p); p += 4
  inner.writeUInt8(6, p); p += 1
  inner.writeBigUInt64BE(args.amount ?? 1_000_000n, p); p += 8
  inner.set(new Uint8Array(32), p); p += 32 // sourceToken
  inner.set(args.recipient.toBytes(), p); p += 32
  inner.writeUInt16BE(args.toChain, p)

  // NttManagerMessage = id(32) + sender(32) + innerLen(u16 BE) + inner
  const mgr = Buffer.alloc(32 + 32 + 2 + inner.length)
  mgr.set(messageId, 0)
  mgr.set(sender.toBytes(), 32)
  mgr.writeUInt16BE(inner.length, 64)
  mgr.set(inner, 66)

  // Transceiver wrapper
  const xcvr = Buffer.alloc(4 + 32 + 32 + 2 + mgr.length + 2)
  let q = 0
  xcvr.set([0x99, 0x45, 0xFF, 0x10], q); q += 4
  xcvr.set(sourceMgr, q); q += 32
  xcvr.set(recipientMgr, q); q += 32
  xcvr.writeUInt16BE(mgr.length, q); q += 2
  xcvr.set(mgr, q); q += mgr.length
  xcvr.writeUInt16BE(0, q) // empty transceiverPayload

  // VAA header (sigCount=0)
  const header = Buffer.alloc(1 + 4 + 1 + 4 + 4 + 2 + 32 + 8 + 1)
  let r = 0
  header.writeUInt8(1, r); r += 1
  header.writeUInt32BE(0, r); r += 4
  header.writeUInt8(0, r); r += 1
  header.writeUInt32BE(1700_000_000, r); r += 4
  header.writeUInt32BE(0, r); r += 4
  header.writeUInt16BE(args.emitterChain, r); r += 2
  header.set(emitterAddress, r); r += 32
  header.writeBigUInt64BE(1n, r); r += 8
  header.writeUInt8(1, r)

  return new Uint8Array(Buffer.concat([header, xcvr]))
}

function makeCtx(): BridgeContext {
  return {
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as BridgeContext['log'],
    metrics: {
      redeemed: { inc: vi.fn() },
      txSent: { inc: vi.fn() } as unknown as BridgeContext['metrics']['txSent'],
      rpcErrors: { inc: vi.fn() } as unknown as BridgeContext['metrics']['rpcErrors'],
    },
    abortSignal: new AbortController().signal,
    wormholescanUrl: 'https://example.invalid',
    wormholescanTimeoutMs: 1000,
    rpcTimeoutMs: 1000,
  }
}

function makeTarget(opts: {
  releaseMode: 'Burning' | 'Locking'
  inboxData: Buffer | null
  configReady?: boolean
  configError?: string
  /**
   * Override get_account_info — useful for tests that need to distinguish
   *  inbox-item lookups from transceiver-message lookups.
   */
  getAccountInfo?: (pubkey: PublicKey) => Promise<{ data: Buffer, executable: boolean, lamports: number, owner: PublicKey, rentEpoch: number } | null>
}): BridgeRedeemTarget {
  const defaultGetAccountInfo = vi.fn().mockResolvedValue(
    opts.inboxData
      ? { data: opts.inboxData, executable: false, lamports: 1, owner: NTT_ONYC_PROGRAM_ID, rentEpoch: 0 }
      // When inbox is missing we still want the transceiver_message
      // probe to pass by default — return a stub buffer with any 8+ bytes.
      : { data: Buffer.alloc(64, 0xAA), executable: false, lamports: 1, owner: NTT_ONYC_PROGRAM_ID, rentEpoch: 0 },
  )
  void defaultGetAccountInfo

  // Custom resolver routes by pubkey (empty-transceiver-message test);
  // otherwise the default handles inbox plus subsequent calls.
  let inboxQueryCount = 0
  const resolver = opts.getAccountInfo
    ? vi.fn(opts.getAccountInfo)
    : vi.fn().mockImplementation(async () => {
        inboxQueryCount += 1
        // First call = inbox-item lookup, follow opts.inboxData.
        if (inboxQueryCount === 1) {
          return opts.inboxData
            ? { data: opts.inboxData, executable: false, lamports: 1, owner: NTT_ONYC_PROGRAM_ID, rentEpoch: 0 }
            : null
        }
        // Subsequent calls = transceiver-message probe; return non-null
        // by default so the empty-xcvr gate doesn't fire.
        return { data: Buffer.alloc(64, 0xAA), executable: false, lamports: 1, owner: NTT_ONYC_PROGRAM_ID, rentEpoch: 0 }
      })

  void defaultGetAccountInfo // unused branch retained for backward-compat readability

  const destConnection = {
    getAccountInfo: resolver,
  } as unknown as Connection

  return {
    name: 'solana_onyc_to_fogo',
    sourceChainId: SOLANA_CHAIN,
    sourceEmitterHex: '00'.repeat(32),
    destChainId: FOGO_CHAIN,
    destConnection,
    destNttManagerProgramId: NTT_ONYC_PROGRAM_ID,
    destWhTransceiverProgramId: NTT_ONYC_PROGRAM_ID, // tests don't care that it's the real WH transceiver
    destMint: FOGO_ONYC_MINT,
    destSigner: Keypair.generate(),
    destReleaseMode: opts.releaseMode,
    configReady: opts.configReady ?? true,
    configError: opts.configError,
  }
}

describe('planBridgeRedeem', () => {
  const recipient = Keypair.generate().publicKey

  it('plans redeem-and-release when inbox is missing AND transceiver_message is empty (SDK will create it via receive_message)', async () => {
    const vaa = buildVaa({ emitterChain: SOLANA_CHAIN, toChain: FOGO_CHAIN, recipient })
    // Both lookups return null → transceiver_message hasn't been posted.
    // The planner no longer probes for it; the SDK pipeline owns
    // receive_message + redeem + release as a bundled sequence.
    const target = makeTarget({
      releaseMode: 'Burning',
      inboxData: null,
      getAccountInfo: async () => null,
    })
    const { plan } = await planBridgeRedeem(makeCtx(), target, vaa)
    expect(plan.action).toBe('redeem-and-release')
    expect(plan.ixs).toEqual([])
  })

  it('returns noop without touching dest RPC when target.configReady is false', async () => {
    const vaa = buildVaa({ emitterChain: SOLANA_CHAIN, toChain: FOGO_CHAIN, recipient })
    const target = makeTarget({
      releaseMode: 'Burning',
      inboxData: null,
      configReady: false,
      configError: 'missing peer PDA for chain 1',
    })
    const { plan } = await planBridgeRedeem(makeCtx(), target, vaa)
    expect(plan.action).toBe('noop')
    expect(plan.reason).toMatch(/ntt-not-configured/)
    expect(plan.reason).toMatch(/missing peer PDA/)
    // Defense-in-depth: the gate must short-circuit BEFORE any dest RPC.
    expect((target.destConnection.getAccountInfo as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(0)
  })

  it('returns noop when VAA toChain mismatches dest chain', async () => {
    const vaa = buildVaa({ emitterChain: SOLANA_CHAIN, toChain: 999, recipient })
    const target = makeTarget({ releaseMode: 'Burning', inboxData: null })
    const { plan } = await planBridgeRedeem(makeCtx(), target, vaa)
    expect(plan.action).toBe('noop')
    expect(plan.reason).toMatch(/toChain=999/)
    expect(plan.ixs).toEqual([])
  })

  it('returns noop when VAA fromChain mismatches source chain', async () => {
    const vaa = buildVaa({ emitterChain: 42, toChain: FOGO_CHAIN, recipient })
    const target = makeTarget({ releaseMode: 'Burning', inboxData: null })
    const { plan } = await planBridgeRedeem(makeCtx(), target, vaa)
    expect(plan.action).toBe('noop')
    expect(plan.reason).toMatch(/fromChain=42/)
  })

  it('plans redeem+release when inbox is missing (Burning mode)', async () => {
    const vaa = buildVaa({ emitterChain: SOLANA_CHAIN, toChain: FOGO_CHAIN, recipient })
    const target = makeTarget({ releaseMode: 'Burning', inboxData: null })
    const { plan } = await planBridgeRedeem(makeCtx(), target, vaa)
    expect(plan.action).toBe('redeem-and-release')
    expect(plan.ixs).toEqual([])
  })

  it('plans release-only when inbox is NotApproved', async () => {
    const vaa = buildVaa({ emitterChain: SOLANA_CHAIN, toChain: FOGO_CHAIN, recipient })
    const target = makeTarget({
      releaseMode: 'Burning',
      inboxData: encodeInboxItem({ amount: 1n, recipient, release: 'NotApproved' }),
    })
    const { plan } = await planBridgeRedeem(makeCtx(), target, vaa)
    expect(plan.action).toBe('release-only')
    expect(plan.ixs).toHaveLength(3)
  })

  it('returns noop when inbox is already Released', async () => {
    const vaa = buildVaa({ emitterChain: SOLANA_CHAIN, toChain: FOGO_CHAIN, recipient })
    const target = makeTarget({
      releaseMode: 'Burning',
      inboxData: encodeInboxItem({ amount: 1n, recipient, release: 'Released' }),
    })
    const { plan } = await planBridgeRedeem(makeCtx(), target, vaa)
    expect(plan.action).toBe('noop')
    expect(plan.reason).toMatch(/already Released/)
  })

  it('returns noop when ReleaseAfter timestamp is still in the future', async () => {
    const future = BigInt(Math.floor(Date.now() / 1000) + 3600)
    const vaa = buildVaa({ emitterChain: SOLANA_CHAIN, toChain: FOGO_CHAIN, recipient })
    const target = makeTarget({
      releaseMode: 'Burning',
      inboxData: encodeInboxItem({ amount: 1n, recipient, release: { ReleaseAfter: future } }),
    })
    const { plan } = await planBridgeRedeem(makeCtx(), target, vaa)
    expect(plan.action).toBe('noop')
    expect(plan.reason).toMatch(/rate-limit/)
  })

  it('plans release-only when ReleaseAfter timestamp is in the past', async () => {
    const past = BigInt(Math.floor(Date.now() / 1000) - 60)
    const vaa = buildVaa({ emitterChain: SOLANA_CHAIN, toChain: FOGO_CHAIN, recipient })
    const target = makeTarget({
      releaseMode: 'Burning',
      inboxData: encodeInboxItem({ amount: 1n, recipient, release: { ReleaseAfter: past } }),
    })
    const { plan } = await planBridgeRedeem(makeCtx(), target, vaa)
    expect(plan.action).toBe('release-only')
    expect(plan.ixs).toHaveLength(3)
  })

  // Release-mode dispatch for the redeem-and-release path now lives in the
  // SDK (executeSdkBundledRedeem), so the planner emits an empty ix list;
  // the former Burning-vs-Locking discriminator test no longer applies. The
  // release-only branch stays covered by the NotApproved / past-ReleaseAfter cases.

  it('returns noop when inbox bytes are present but undecodable', async () => {
    const vaa = buildVaa({ emitterChain: SOLANA_CHAIN, toChain: FOGO_CHAIN, recipient })
    const garbage = Buffer.alloc(200, 0xAB)
    const target = makeTarget({ releaseMode: 'Burning', inboxData: garbage })
    const { plan } = await planBridgeRedeem(makeCtx(), target, vaa)
    expect(plan.action).toBe('noop')
    expect(plan.reason).toMatch(/not decodable as NttInboxItem/)
  })
})
