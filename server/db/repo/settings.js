import { q, one, run } from '../index.js'

/** 读取单个设置（自动 JSON 解析） */
export function get(key, fallback = null) {
  const row = one('SELECT value FROM settings WHERE key = ?', key)
  if (!row) return fallback
  try { return JSON.parse(row.value) } catch { return row.value }
}

/** 写入设置 */
export function set(key, value, isSecret = 0) {
  const v = typeof value === 'string' ? JSON.stringify(value) : JSON.stringify(value)
  run(`INSERT INTO settings(key, value, is_secret, updated_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value=excluded.value, is_secret=excluded.is_secret, updated_at=datetime('now')`,
    key, v, isSecret)
}

export function setMany(obj) {
  for (const [k, v] of Object.entries(obj)) set(k, v)
}

/** 全量读取（含明文密钥，仅服务端内部用） */
export function getAll() {
  const out = {}
  for (const r of q('SELECT key, value FROM settings')) {
    try { out[r.key] = JSON.parse(r.value) } catch { out[r.key] = r.value }
  }
  return out
}

function mask(v) {
  const s = String(v ?? '')
  if (s.length <= 8) return s ? '••••' : ''
  return s.slice(0, 4) + '••••' + s.slice(-4)
}

/** 给前端读的设置（is_secret=1 的只返回掩码） */
export function getPublic() {
  const out = {}
  for (const r of q('SELECT key, value, is_secret FROM settings')) {
    let v
    try { v = JSON.parse(r.value) } catch { v = r.value }
    out[r.key] = r.is_secret ? mask(v) : v
  }
  return out
}

export const SECRET_KEYS = [
  'llm.compat.apiKey',
  'search.tavily.apiKey',
  'search.bocha.apiKey',
  'search.serper.apiKey',
  'search.brave.apiKey'
]

/** 保存设置：值为掩码字符串时保持原值不变 */
export function savePublic(obj) {
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string' && v.includes('••••')) continue // 用户没改密钥
    const isSecret = SECRET_KEYS.includes(k) ? 1 : 0
    set(k, v, isSecret)
  }
}

/* ---------------- 默认设置 ---------------- */
export const DEFAULTS = {
  'llm.provider': 'compat',                    // compat | cloud
  'llm.compat.baseUrl': 'https://api.deepseek.com/v1',
  'llm.compat.apiKey': '',
  'llm.compat.model': 'deepseek-chat',
  'llm.compat.temperature': 0.3,
  // 鲁棒性相关（本地小模型 / 弱网络必备）
  'llm.compat.timeoutMs': 180000,   // 单次请求总超时
  'llm.compat.stallMs': 90000,      // 流式中多久没新数据就判定卡死（本地模型崩了靠这个发现）
  'llm.maxOutputTokens': 0,         // 0=不限制；小模型建议 1024~2048，防止它跑飞
  'llm.weakModel': false,           // 轻量模式：更少子问题/更少检索/不写深度版
  'pipeline.stallMs': 180000,       // 看门狗：流水线多久没有任何动静就判定中断
  'pipeline.autoResume': false,     // 中断后是否自动重试一次当前阶段
  'pipeline.enableFetch': true,     // 抓取来源正文（关了就只用搜索摘要，证据会变少且容易"未找到"）
  'llm.cloud.endpoint': '',
  'llm.cloud.publishableKey': '',
  'llm.cloud.resourceId': '',
  'llm.cloud.modelId': '',
  'search.provider': 'auto',                   // auto(多引擎聚合) | duckduckgo | bing | baidu | sogou | so360 | bing-rss | wikipedia | knowledge | tavily | bocha | serper | brave
  'search.engines': ['duckduckgo', 'bing', 'baidu', 'sogou', 'so360'], // 启用哪些联网引擎（auto 模式下并行打）
  'search.perDomainCap': 3,                    // 每个域名最多保留几条（保证来源多样性）
  'search.relevanceGate': true,                // 相关性闸门：剔除与话题无关的填充结果（建议开）
  'search.tavily.apiKey': '',
  'search.bocha.apiKey': '',
  'search.serper.apiKey': '',
  'search.brave.apiKey': '',
  'proxy.mode': 'off',                         // off | auto | on
  'proxy.url': 'http://127.0.0.1:7890',
  'budget.mode': 'standard',
  'concurrency.llm': 2,
  'concurrency.search': 4,
  'concurrency.fetch': 4,
  'diag.cloudLlm': null
}

export function ensureDefaults() {
  for (const [k, v] of Object.entries(DEFAULTS)) {
    const row = one('SELECT key FROM settings WHERE key = ?', k)
    if (!row) set(k, v, SECRET_KEYS.includes(k) ? 1 : 0)
  }
}
