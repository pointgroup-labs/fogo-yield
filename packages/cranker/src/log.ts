export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal'
export type LogFields = Record<string, unknown>

const ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  fatal: 50,
}

export type Logger = {
  debug: (msg: string, fields?: LogFields) => void
  info: (msg: string, fields?: LogFields) => void
  warn: (msg: string, fields?: LogFields) => void
  error: (msg: string, fields?: LogFields) => void
  fatal: (msg: string, fields?: LogFields) => void
  child: (extra: LogFields) => Logger
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function errorFields(err: unknown): LogFields {
  return { err: err instanceof Error ? err : String(err) }
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, (_k, v) => {
      if (typeof v === 'bigint') {
        return v.toString()
      }
      if (v instanceof Error) {
        return { name: v.name, message: v.message, stack: v.stack }
      }
      return v
    })
  } catch (err) {
    return JSON.stringify({ __serializeError: String(err) })
  }
}

export function writeLogLine(level: LogLevel, msg: string, fields: LogFields = {}): void {
  console.error(safeStringify({
    level,
    msg,
    time: new Date().toISOString(),
    ...fields,
  }))
}

export function createLogger(opts: { level: LogLevel, base?: LogFields } = { level: 'info' }): Logger {
  const threshold = ORDER[opts.level]
  const base = opts.base ?? {}

  const emit = (level: LogLevel, msg: string, fields?: LogFields): void => {
    if (ORDER[level] < threshold) {
      return
    }
    writeLogLine(level, msg, { ...base, ...fields })
  }

  return {
    debug: (msg, fields) => emit('debug', msg, fields),
    info: (msg, fields) => emit('info', msg, fields),
    warn: (msg, fields) => emit('warn', msg, fields),
    error: (msg, fields) => emit('error', msg, fields),
    fatal: (msg, fields) => emit('fatal', msg, fields),
    child: extra => createLogger({ level: opts.level, base: { ...base, ...extra } }),
  }
}

/**
 * No-op logger for tests — discards every emission. Avoids polluting test
 * stderr with diagnostic chatter from production-path debug/info/warn calls.
 */
export function silentLogger(): Logger {
  const noop = (): void => {}
  const self: Logger = {
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    fatal: noop,
    child: () => self,
  }
  return self
}
