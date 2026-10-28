/**
 * 检索出口统一封装（供各搜索适配器使用）。
 * - 支持代理：先直连，直连失败且配置了代理时再走代理重试（国内站点在受限网络下常需要）。
 * - 统一 UA / 超时 / 实体解码。
 */
import { fetch as undiciFetch, ProxyAgent } from 'undici'

export const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

let proxyAgent = null
let proxyUrl = null

/** 由服务端在启动 / 保存设置时调用 */
export function setProxy(url) {
  proxyUrl = url || null
  try { proxyAgent = proxyUrl ? new ProxyAgent(proxyUrl) : null } catch { proxyAgent = null }
  return !!proxyAgent
}
export function getProxy() { return proxyUrl }

async function once(url, { headers, timeoutMs, signal, dispatcher }) {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  const onAbort = () => ac.abort()
  if (signal) signal.addEventListener('abort', onAbort, { once: true })
  try {
    const res = await undiciFetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: ac.signal,
      headers,
      ...(dispatcher ? { dispatcher } : {})
    })
    const text = await res.text()
    return { ok: res.ok, status: res.status, text, finalUrl: res.url }
  } finally {
    clearTimeout(timer)
    if (signal) signal.removeEventListener?.('abort', onAbort)
  }
}

/**
 * GET 一个 URL。
 * @returns {{ok:boolean, status:number, text:string, error?:string, viaProxy?:boolean}}
 */
export async function httpGet(url, { headers = {}, timeoutMs = 12000, signal, referer = null } = {}) {
  const h = { 'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8', ...headers }
  if (referer) h.Referer = referer

  try {
    const r = await once(url, { headers: h, timeoutMs, signal })
    if (r.ok || (r.status && r.status < 500)) return r
    // 5xx 也尝试代理
  } catch (e) {
    // 直连失败，落到代理
  }
  if (proxyAgent) {
    try {
      const r = await once(url, { headers: h, timeoutMs, signal, dispatcher: proxyAgent })
      return { ...r, viaProxy: true }
    } catch (e) {
      return { ok: false, status: 0, text: '', error: e.message }
    }
  }
  return { ok: false, status: 0, text: '', error: 'fetch failed（无可用代理）' }
}

/** HTML 实体解码 */
export function decodeEntities(s) {
  return String(s || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCodePoint(Number(n)) } catch { return '' } })
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => { try { return String.fromCodePoint(parseInt(n, 16)) } catch { return '' } })
}

/** 去标签 + 解码 + 压空白 */
export function stripHtml(s) {
  return decodeEntities(String(s || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
}
