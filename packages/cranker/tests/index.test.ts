import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { installShutdownHandlers } from '../src/index'

describe('installShutdownHandlers', () => {
  afterEach(() => {
    process.removeAllListeners('SIGTERM')
    process.removeAllListeners('SIGINT')
  })

  it('aborts controller on SIGTERM', () => {
    const ctrl = new AbortController()
    installShutdownHandlers(ctrl)
    expect(ctrl.signal.aborted).toBe(false)
    process.emit('SIGTERM')
    expect(ctrl.signal.aborted).toBe(true)
  })

  it('aborts controller on SIGINT', () => {
    const ctrl = new AbortController()
    installShutdownHandlers(ctrl)
    process.emit('SIGINT')
    expect(ctrl.signal.aborted).toBe(true)
  })
})

describe('main() invariant ordering (structural)', () => {
  // Reading the source as text is unusual but proportionate: the failure
  // we're guarding against is "someone refactored main() and accidentally
  // moved metrics binding below the slow RPC fetch". Mocking the entire
  // dependency graph to drive a real main() invocation costs ~200 lines
  // of test setup for one ordering check; this costs ~10.
  const src = readFileSync(join(__dirname, '..', 'src', 'index.ts'), 'utf8')

  it('binds metrics server before any async dependency that could fail slow', () => {
    // Healthz must answer 503 during cold-start RPC fetches so Docker's
    // healthcheck has a target. metrics.start() must precede fetchConfig().
    const startIdx = src.indexOf('await metrics.start()')
    const fetchIdx = src.indexOf('await client.fetchConfig()')
    expect(startIdx).toBeGreaterThan(-1)
    expect(fetchIdx).toBeGreaterThan(-1)
    expect(startIdx).toBeLessThan(fetchIdx)
  })
})
