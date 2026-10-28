import fs from 'node:fs'
import path from 'node:path'
import { LOG_DIR } from '../config.js'

const streams = new Map()

function getStream(name) {
  if (!streams.has(name)) {
    const f = fs.createWriteStream(path.join(LOG_DIR, `${name}.log`), { flags: 'a' })
    streams.set(name, f)
  }
  return streams.get(name)
}

function ts() {
  return new Date().toISOString()
}

export function log(msg, name = 'app') {
  const line = `[${ts()}] ${msg}\n`
  try {
    getStream(name).write(line)
  } catch {}
  if (process.env.NODE_ENV !== 'production' || process.env.LOG_CONSOLE === '1') {
    process.stdout.write(line)
  }
}

export function runLogger(runId) {
  return {
    info: (m) => log(m, `run-${runId}`),
    warn: (m) => log(`[WARN] ${m}`, `run-${runId}`),
    error: (m) => log(`[ERROR] ${m}`, `run-${runId}`)
  }
}

export function safeErr(e) {
  if (!e) return 'unknown'
  return e.message || String(e)
}
