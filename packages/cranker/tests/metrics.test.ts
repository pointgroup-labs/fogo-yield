import type { IncomingMessage, ServerResponse } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import { createMetrics } from '../src/metrics'

type RequestHandler = (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
type CloseCallback = (err?: Error) => void

let requestHandler: RequestHandler | undefined

vi.mock('node:http', () => ({
  createServer: vi.fn((handler: RequestHandler) => {
    requestHandler = handler
    const server = {
      listen: (_port: number, _host: string, callback: () => void) => {
        callback()
        return server
      },
      address: () => ({ port: 12345 }),
      close: (callback: CloseCallback) => {
        callback()
        return server
      },
    }
    return server
  }),
}))

async function request(url: string): Promise<{ statusCode: number, body: string, headers: Record<string, string> }> {
  if (!requestHandler) {
    throw new Error('metrics server was not started')
  }
  let body = ''
  const headers: Record<string, string> = {}
  const req = { url } as IncomingMessage
  const res = {
    statusCode: 200,
    setHeader: (name: string, value: number | string | readonly string[]) => {
      headers[name.toLowerCase()] = Array.isArray(value) ? value.join(', ') : String(value)
    },
    end: (chunk?: string | Uint8Array) => {
      if (chunk !== undefined) {
        body += chunk.toString()
      }
    },
  } as ServerResponse

  await requestHandler(req, res)
  return { statusCode: res.statusCode, body, headers }
}

describe('createMetrics', () => {
  it('starts http server, exposes /metrics and /healthz', async () => {
    const m = createMetrics({ port: 0, heartbeatStaleMs: 90_000 })
    await m.start()
    const port = m.actualPort()

    m.heartbeat.setNow()
    const healthRes = await request('/healthz')
    expect(port).toBe(12345)
    expect(healthRes.statusCode).toBe(200)

    const metricsRes = await request('/metrics')
    expect(metricsRes.statusCode).toBe(200)
    expect(metricsRes.body).toMatch(/cranker_scan_iterations_total/)

    await m.stop()
  })

  it('healthz returns 503 when heartbeat is stale', async () => {
    const m = createMetrics({ port: 0, heartbeatStaleMs: 100 })
    await m.start()

    m.heartbeat.setAt(Date.now() - 200)
    const res = await request('/healthz')
    expect(res.statusCode).toBe(503)

    await m.stop()
  })
})
