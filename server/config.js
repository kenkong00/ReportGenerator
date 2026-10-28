import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export const ROOT = path.resolve(__dirname, '..')
export const SERVER_DIR = __dirname
export const SRC_DIR = path.join(ROOT, 'src')
export const DIST_DIR = path.join(SRC_DIR, 'dist')
export const DATA_DIR = path.join(ROOT, 'data')
export const LOG_DIR = path.join(DATA_DIR, 'logs')
export const EXPORT_DIR = path.join(DATA_DIR, 'exports')
export const DB_PATH = path.join(DATA_DIR, 'research.db')

export const PORT = Number(process.env.PORT || 5210)
export const VITE_PORT = 5209

for (const dir of [DATA_DIR, LOG_DIR, EXPORT_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

/**
 * 三档深度的默认预算。
 *   快看：只做信息聚合，来源少而精，快速摸清情况（适合生活/娱乐话题）
 *   标准：分节讲清来龙去脉
 *   深研：多来源 + 逐节扩写（适合需要完整论证的严肃课题）
 */
export const BUDGET_PRESETS = {
  quick:    { maxSearches: 12, maxFetches: 8,  maxTokens: 250_000, maxWallClockMs: 12 * 60_000, targetWords: [800, 1500] },
  standard: { maxSearches: 30, maxFetches: 24, maxTokens: 700_000, maxWallClockMs: 25 * 60_000, targetWords: [3000, 8000] },
  deep:     { maxSearches: 60, maxFetches: 45, maxTokens: 1_600_000, maxWallClockMs: 45 * 60_000, targetWords: [12000, 25000] }
}

/**
 * 本地推理服务（LM Studio / Ollama / llama.cpp / vLLM）的吞吐只有云端的几分之一，
 * 墙钟预算若按云端标定，往往在「装配报告」之前就触顶 —— 用户等了半天却拿不到报告。
 * 这里按地址自动识别本机服务并放宽墙钟（3 倍，且不低于 40 分钟）；
 * 用户在项目里显式写过 budget_json 的，尊重用户的数字，不做调整。
 */
export function relaxWallclockForLocal(preset, { provider, baseUrl } = {}) {
  const name = String(provider || 'compat')
  if (name !== 'compat' && name !== 'openai-compat') return preset
  if (!isLocalEndpoint(baseUrl)) return preset
  return {
    ...preset,
    maxWallClockMs: Math.max(Number(preset.maxWallClockMs || 0) * 3, 40 * 60_000)
  }
}

function isLocalEndpoint(url) {
  const s = String(url || '').trim()
  if (!s) return false
  let host = ''
  try { host = new URL(/^https?:\/\//i.test(s) ? s : 'http://' + s).hostname } catch { return false }
  if (!host) return false
  if (['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]'].includes(host)) return true
  if (host.endsWith('.local') || host.endsWith('.localhost')) return true
  return /^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)
}

/** 并发上限 */
export const CONCURRENCY = {
  llm: 2,
  search: 4,
  fetch: 4,
  fetchPerDomainDelayMs: 500
}

export const LLM_RATE_LIMIT = { maxPerMinute: 20 }
