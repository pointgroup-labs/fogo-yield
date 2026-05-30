import {
  findIntentTransferSetterPda,
  INTENT_TRANSFER_PROGRAM_ID,
  ONRE_INTENT_PROGRAM_ID,
} from '@fogo-onre/sdk'
import { describe, expect, it } from 'vitest'

describe('findIntentTransferSetterPda', () => {
  it('defaults to the Fogo program id (back-compat)', () => {
    const [byDefault] = findIntentTransferSetterPda()
    const [explicit] = findIntentTransferSetterPda(INTENT_TRANSFER_PROGRAM_ID)
    expect(byDefault.equals(explicit)).toBe(true)
  })

  it('derives a distinct setter for the OnRe fork program id', () => {
    const [fogo] = findIntentTransferSetterPda(INTENT_TRANSFER_PROGRAM_ID)
    const [onre] = findIntentTransferSetterPda(ONRE_INTENT_PROGRAM_ID)
    // Same seed, different program id → distinct setter PDA. This is what lets
    // replay monitoring tell an OnRe-routed sender from a Fogo-routed one.
    expect(fogo.equals(onre)).toBe(false)
  })
})
