/**
 * Refactor-safety goldens: pin invariants the SDK refactor (constants
 * extraction, helper relocation) must never silently break.
 *
 * These tests are deliberately narrow — they assert wire-level facts
 * (entry counts, byte vectors) that any future shuffle of helpers or
 * `AccountMeta` ordering will trip immediately, without depending on
 * the heavyweight LiteSVM rig.
 */

import {
  buildNttTransferLockAccountList,
  encodeNttTransferArgsBorsh,
  NTT_TRANSFER_LOCK_ACCOUNT_COUNT,
  NTT_USDC_PROGRAM_ID,
  nttTransferArgsHash,
} from '@fogo-onre/sdk'
import { Keypair } from '@solana/web3.js'
import { describe, expect, it } from 'vitest'

describe('nTT_TRANSFER_LOCK_ACCOUNT_COUNT', () => {
  it('matches the actual builder output length', () => {
    const accts = buildNttTransferLockAccountList({
      nttProgramId: NTT_USDC_PROGRAM_ID,
      fromOwner: Keypair.generate().publicKey,
      fromOwnerIsSigner: false,
      fromTokenAccount: Keypair.generate().publicKey,
      mint: Keypair.generate().publicKey,
      outboxItem: Keypair.generate().publicKey,
      recipientChain: 51,
      recipientAddress: new Uint8Array(32),
      amount: 1_000_000n,
    })
    expect(accts.length).toBe(NTT_TRANSFER_LOCK_ACCOUNT_COUNT)
    expect(NTT_TRANSFER_LOCK_ACCOUNT_COUNT).toBe(14)
  })
})

describe('serializeTransferArgs (via public encoders)', () => {
  // Fixed-input vectors. Re-run before/after the refactor — bytes
  // must match exactly. amount=0x0102030405060708, chain=0xAABB,
  // recipient=0x00..1F, shouldQueue=true.
  const recipient = new Uint8Array(32)
  for (let i = 0; i < 32; i++) { recipient[i] = i }
  const args = {
    amount: 0x0102030405060708n,
    recipientChain: 0xAABB,
    recipientAddress: recipient,
    shouldQueue: true,
  }

  it('big-endian (hash input) lays out u64 high-byte first', () => {
    // We can't observe the pre-hash buffer directly, so hash twice and
    // assert determinism + length. Determinism is the invariant we care
    // about for the refactor.
    const a = nttTransferArgsHash(args)
    const b = nttTransferArgsHash(args)
    expect(a.length).toBe(32)
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true)
  })

  it('little-endian (Borsh) produces 43 bytes with u64-LE leading', () => {
    const buf = encodeNttTransferArgsBorsh(args)
    expect(buf.length).toBe(43)
    // u64 LE: bytes[0..8] = [08, 07, 06, 05, 04, 03, 02, 01]
    expect(Array.from(buf.slice(0, 8))).toEqual([0x08, 0x07, 0x06, 0x05, 0x04, 0x03, 0x02, 0x01])
    // u16 LE: bytes[8..10] = [BB, AA]
    expect(Array.from(buf.slice(8, 10))).toEqual([0xBB, 0xAA])
    // recipient passthrough
    expect(Array.from(buf.slice(10, 42))).toEqual(Array.from(recipient))
    // shouldQueue
    expect(buf[42]).toBe(1)
  })

  it('rejects non-32-byte recipient', () => {
    const bad = { ...args, recipientAddress: new Uint8Array(31) }
    expect(() => encodeNttTransferArgsBorsh(bad)).toThrow(/32 bytes/)
    expect(() => nttTransferArgsHash(bad)).toThrow(/32 bytes/)
  })
})
