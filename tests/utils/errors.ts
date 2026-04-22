import type { PublicKey } from '@solana/web3.js'
import { expect } from 'vitest'

const ERROR_CODE_RE = /Error Code: (\w+)/

/**
 * Pull program logs off a thrown error, regardless of how the SDK
 * surfaced them. anchor-litesvm's SendTransactionError pre-loads them
 * onto `.logs` (string[]); some web3.js paths attach them via `.getLogs()`
 * (sync or async); plain Error objects have neither.
 */
function readLogs(error: unknown): string[] {
  const e = error as { logs?: unknown, getLogs?: () => unknown }
  if (Array.isArray(e?.logs)) {
    return e.logs as string[]
  }
  if (typeof e?.getLogs === 'function') {
    const r = e.getLogs()
    if (Array.isArray(r)) {
      return r as string[]
    }
  }
  return []
}

/**
 * Combined searchable surface: the error message + every log line.
 * Both LiteSVM and web3.js sometimes put the Anchor `Error Code:` line
 * in different places, so we look in both.
 */
function errorSurface(error: unknown): string {
  return `${String((error as { message?: unknown })?.message ?? error)}\n${readLogs(error).join('\n')}`
}

/**
 * Extract Anchor error code from a failed LiteSVM transaction.
 * Anchor logs errors as `Program log: AnchorError ... Error Code: <name>`.
 * Searches the error message AND captured logs (LiteSVM puts the actual
 * code in logs, not message).
 */
export function extractErrorCode(error: unknown): string | null {
  const match = errorSurface(error).match(ERROR_CODE_RE)
  return match?.[1] ?? null
}

/**
 * Assert that an async action throws with a specific Anchor error code.
 */
export async function expectError(fn: () => Promise<unknown> | unknown, code: string) {
  try {
    await fn()
    throw new Error(`Expected error ${code} but succeeded`)
  } catch (e: unknown) {
    const actual = extractErrorCode(e)
    expect(actual, `expected Anchor error '${code}', got logs:\n${readLogs(e).join('\n')}`).toBe(code)
  }
}

/**
 * Predicate over (logs, message) — see `failedInProgram` and `logMatches`
 * for the canonical builders.
 */
export type FailurePredicate = (logs: string[], message: string) => boolean

/**
 * Assert that an async action throws AND its captured failure surface
 * (logs + message) satisfies `predicate`. Use this when the failure path
 * is deterministic but doesn't surface as a single Anchor error code —
 * e.g., "fails inside an upstream CPI" or "system program returns
 * 'already in use'".
 *
 * `description` is shown verbatim in the assertion-failed message.
 */
export async function expectFailure(
  fn: () => Promise<unknown> | unknown,
  predicate: FailurePredicate,
  description: string,
) {
  let caught: unknown
  try {
    await fn()
  } catch (e) {
    caught = e
  }
  if (caught === undefined) {
    throw new Error(`Expected failure (${description}) but the call succeeded`)
  }
  const logs = readLogs(caught)
  const message = String((caught as { message?: unknown }).message ?? '')
  if (!predicate(logs, message)) {
    throw new Error(
      `Failure didn't match: ${description}\n`
      + `Message: ${message}\n`
      + `Logs:\n${logs.length > 0 ? logs.join('\n') : '<no logs captured>'}`,
    )
  }
}

/**
 * Predicate: the captured logs show that `programId` was invoked and
 * returned a failure. Used to assert "the relayer's CPI into program X
 * was reached and X rejected it" — which proves the relayer's own
 * validations passed up to the CPI boundary.
 */
export function failedInProgram(programId: PublicKey): FailurePredicate {
  const id = programId.toBase58()
  const failedRe = new RegExp(`Program ${id}\\s+failed`)
  const consumedRe = new RegExp(`Program ${id}\\s+consumed`)
  return logs => logs.some(l => failedRe.test(l)) || logs.some(l => consumedRe.test(l) && logs.some(x => failedRe.test(x)))
}

/**
 * Predicate: at least one log line matches the regex. Use sparingly —
 * prefer Anchor error-code matching when possible.
 */
export function logMatches(re: RegExp): FailurePredicate {
  return logs => logs.some(l => re.test(l))
}
