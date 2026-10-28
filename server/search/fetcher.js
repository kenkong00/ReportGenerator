/**
 * 网络出口层。
 * 设计要点（针对本机网络实测结果）：
 * - 每域名串行 + 请求间隔 ≥500ms，避免被封
 * - UA 轮转
 * - GBK/GB18030 自动解码（国内站点仍有大量 GBK）
 * - 域名熔断：连续失败 3 次 → 本轮暂停
 */
import iconv from 'iconv-lite'
import * as statsRepo from '../db/repo/fetchStats.js'

const UAS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15'
]
let uaIdx = 0
function nextUa() { return UAS[(uaIdx++) % UAS.length] }

const domainQueues = new Map()   // domain -> Promise chain
const lastHit = new Map()        // domain -> timestamp

function domainPaused(domain) {
  const s = statsRepo.get(domain)
  if (!s?.disabled_until) return false
  return new Date(s.disabled_until).getTime() > Date.now()
}

async function delay(ms) { return new Promise(r => setTimeout(r, ms)) }

/** 每域名串行 */
function enqueue(domain, fn) {
  const prev = domainQueues.get(domain) || Promise.resolve()
  const next = prev.then(async () => {
    const last = lastHit.get(domain) || 0
    const wait = 500 - (Date.now() - last)
    if (wait > 0) await delay(wait)
    try { return await fn() } finally { lastHit.set(domain, Date.now()) }
  }).catch(e => ({ error: e }))
  domainQueues.set(domain, next.then(() => {}))
  return next
}

function decode(buf, contentType = '') {
  const ct = String(contentType).toLowerCase()
  let m = ct.match(/charset=([\w-]+)/)
  let enc = m ? m[1] : null
  if (!enc) {
    // 从 HTML meta 里猜
    const head = buf.slice(0, 2048).toString('latin1')
    m = head.match(/charset=["']?([\w-]+)/i)
    enc = m ? m[1] : 'utf-8'
  }
  enc = String(enc).toLowerCase()
  try {
    if (['utf-8', 'utf8'].includes(enc)) return buf.toString('utf8')
    if (iconv.encodingExists(enc)) return iconv.decode(buf, enc)
    return buf.toString('utf8')
  } catch {
    return buf.toString('utf8')
  }
}

/**
 * 抓取一个 URL
 * @returns {{ok:boolean, status?:number, html?:string, error?:string, blocked?:boolean}}
 */
export async function fetchUrl(url, { timeoutMs = 12000, signal } = {}) {
  const domain = (() => { try { return new URL(url).hostname } catch { return 'unknown' } })()
  if (domainPaused(domain)) {
    return { ok: false, blocked: true, error: '域名已熔断（连续失败），本轮跳过' }
  }

  return enqueue(domain, async () => {
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), timeoutMs)
    if (signal) signal.addEventListener('abort', () => ac.abort(), { once: true })
    try {
      const res = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        signal: ac.signal,
        headers: {
          'User-Agent': nextUa(),
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
          'Cache-Control': 'no-cache'
        }
      })
      clearTimeout(timer)
      if (!res.ok) {
        statsRepo.recordFail(domain)
        return { ok: false, status: res.status, error: `HTTP ${res.status}` }
      }
      const buf = Buffer.from(await res.arrayBuffer())
      const html = decode(buf, res.headers.get('content-type') || '')
      statsRepo.recordOk(domain)
      return { ok: true, status: res.status, html, finalUrl: res.url }
    } catch (e) {
      clearTimeout(timer)
      statsRepo.recordFail(domain)
      const msg = e.name === 'AbortError' ? `超时（${timeoutMs}ms）` : e.message
      return { ok: false, error: msg }
    }
  })
}

/** 批量抓取（受全局并发限制 + 预算） */
export async function fetchMany(urls, { limit = 4, onResult, budget, signal } = {}) {
  const out = []
  let i = 0
  const workers = new Array(Math.min(limit, urls.length)).fill(0).map(async () => {
    while (i < urls.length) {
      const idx = i++
      if (budget && !budget.can('fetches')) {
        budget.degrade('fetch_budget_hit', '正文抓取预算耗尽，改用搜索摘要作为证据')
        break
      }
      const url = urls[idx]
      const r = await fetchUrl(url, { signal })
      if (budget) budget.spend('fetches', 1)
      const item = { url, ...r }
      out.push(item)
      onResult?.(item, idx, urls.length)
    }
  })
  await Promise.all(workers)
  return out
}
