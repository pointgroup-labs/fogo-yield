import { FOGO_WORMHOLE_CHAIN_ID, nttTransferArgsHash } from '@fogo-yield/sdk'
import { PublicKey } from '@solana/web3.js'
import { describe, expect, it } from 'vitest'

/**
 * Regression guard for `send.ts`: `flow.recipient` decodes to a `PublicKey`
 * (Flow.recipient is a Pubkey, not bytes). The outbound NTT transfer must
 * encode it via `.toBytes()` → 32 bytes. The prior `Uint8Array.from(pk as
 * ArrayLike<number>)` yielded a length-0 array, which `nttTransferArgsHash`
 * rejects — hard-failing the terminal send leg and stranding the flow.
 */
describe('send recipient encoding', () => {
  const recipient = new PublicKey('E88zkA9Pxb1i8EfSHrEW5ZUe6hiQbo8DHWQ3WhDFw7p6')
  const args = (recipientAddress: Uint8Array) => ({
    amount: 1_000_000n,
    recipientChain: FOGO_WORMHOLE_CHAIN_ID,
    recipientAddress,
    shouldQueue: false,
  })

  it('toBytes() yields the 32-byte recipient', () => {
    const bytes = recipient.toBytes()
    expect(bytes.length).toBe(32)
    expect(new PublicKey(bytes).equals(recipient)).toBe(true)
  })

  it('hashes cleanly with the toBytes() recipient', () => {
    const hash = nttTransferArgsHash(args(recipient.toBytes()))
    expect(hash.length).toBe(32)
  })

  it('the old Uint8Array.from(pk) pattern is degenerate and rejected', () => {
    const bad = Uint8Array.from(recipient as unknown as ArrayLike<number>)
    expect(bad.length).toBe(0)
    expect(() => nttTransferArgsHash(args(bad))).toThrow(/must be 32 bytes/)
  })
})
