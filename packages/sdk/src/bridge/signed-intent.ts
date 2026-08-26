/**
 * Read the swap floor back out of the user-signed intent.
 *
 * Intent v0.3 signs `min_out: <u64>` directly (v0.2 signed the inbox PDA
 * derived from it, which is not invertible — hence the `onre:mso:` memo).
 * Recovering it from the intent costs no transaction bytes and is stricter
 * than the memo: an SPL Memo is unsigned data anyone can attach, whereas this
 * line is inside what the user's key covers.
 */

const U64_MAX = (1n << 64n) - 1n

/** Precompile layout: count(1) | padding(1) | count × 14-byte offsets entry. */
const ED25519_ENTRY_LEN = 14
const ED25519_COUNT_LEN = 2
const MESSAGE_OFFSET_AT = 8
const MESSAGE_SIZE_AT = 10
const MESSAGE_IX_INDEX_AT = 12

/** `u16::MAX` in a `*_instruction_index` means "this instruction's own data". */
const CURRENT_IX = 0xFFFF

/**
 * `min_out: <u64>` on its own line. The capture group is the canonical decimal
 * itself — no sign, padding, or radix prefix reaches the range check.
 */
const MIN_OUT_LINE = /(?:^|\n)min_out: (0|[1-9]\d*)(?:\r?\n|$)/g

/**
 * Messages carried inline in an `Ed25519SigVerify` instruction, one per
 * signature entry. Entries whose message lives in a *different* instruction
 * are skipped: every producer of these intents inlines
 * (`buildIntentVerifierIx` and web3.js's `createInstructionWithPublicKey`
 * both write `CURRENT_IX`), so a cross-instruction reference is not our shape.
 */
export function ed25519InlineMessages(ixData: Uint8Array): Uint8Array[] {
  if (ixData.length < ED25519_COUNT_LEN) {
    return []
  }
  const view = new DataView(ixData.buffer, ixData.byteOffset, ixData.byteLength)
  const messages: Uint8Array[] = []
  for (let i = 0; i < ixData[0]; i++) {
    const entry = ED25519_COUNT_LEN + i * ED25519_ENTRY_LEN
    if (entry + ED25519_ENTRY_LEN > ixData.length) {
      break
    }
    if (view.getUint16(entry + MESSAGE_IX_INDEX_AT, true) !== CURRENT_IX) {
      continue
    }
    const offset = view.getUint16(entry + MESSAGE_OFFSET_AT, true)
    const size = view.getUint16(entry + MESSAGE_SIZE_AT, true)
    if (offset + size > ixData.length) {
      continue
    }
    messages.push(ixData.subarray(offset, offset + size))
  }
  return messages
}

/**
 * Every `min_out` the signed intent states, deduped in order. Plural because a
 * hand-crafted message could repeat the line; the caller matches candidates
 * against the VAA recipient PDA, so an extra value can only be ignored, never
 * substituted.
 */
export function parseSignedMinOuts(message: Uint8Array): bigint[] {
  // Not `fatal` — a hardware wallet's envelope prefixes the intent with binary
  // (a 32-byte application domain, the signer key), which is not valid UTF-8.
  const text = new TextDecoder().decode(message)
  const floors: bigint[] = []
  for (const [, digits] of text.matchAll(MIN_OUT_LINE)) {
    const value = BigInt(digits)
    if (value <= U64_MAX && !floors.includes(value)) {
      floors.push(value)
    }
  }
  return floors
}
