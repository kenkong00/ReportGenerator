/**
 * DuckDuckGo HTML 检索适配器 —— 零 key 免费联网检索。
 *
 * 这是众多 AI 编程工具（Cursor / 开源 agent 等）采用的免费联网搜索路线：
 * 直接抓取 https://html.duckduckgo.com/html 的搜索结果页，无需 API key。
 * 结果链接经过 DDG 跳转（/l/?uddg=ENCODED），需还原出真实 URL。
 *
 * 注意：Bing 的 format=rss 搜索源已于多年前下线，会返回垃圾/空页，故用本适配器替代。
 */
import { domainOf } from '../../utils/text.js'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

/** HTML 实体解码 */
function decodeEntities(s) {
  return String(s || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16)))
}

function stripHtml(s) {
  return decodeEntities(String(s || '').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}

/** 从 DDG 跳转链接还原真实 URL */
function realUrl(href) {
  try {
    const m = href.match(/[?&]uddg=([^&]+)/)
    if (m) return decodeURIComponent(m[1])
    if (href.startsWith('http')) return href
  } catch {}
  return null
}

export class DuckDuckGoAdapter {
  constructor(cfg = {}) {
    this.name = 'duckduckgo'
    this.timeoutMs = cfg.timeoutMs ?? 15000
    this.requiresKey = false
    this.lastError = null
  }

  isAvailable() { return true }

  async search(query, { limit = 10, lang = 'zh', signal } = {}) {
    const kl = lang === 'en' ? 'us-en' : 'cn-zh'
    // kp=-1 关闭安全搜索：内容尺度交由提示词层（policy.content）统一管理，不在检索层预过滤
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=${kl}&kp=-1&b=&ia=web`

    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), this.timeoutMs)
    if (signal) signal.addEventListener('abort', () => ac.abort(), { once: true })

    try {
      const res = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        signal: ac.signal,
        headers: {
          'User-Agent': UA,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': lang === 'en' ? 'en-US,en;q=0.9' : 'zh-CN,zh;q=0.9'
        }
      })
      clearTimeout(timer)
      if (!res.ok) {
        this.lastError = `HTTP ${res.status}`
        return []
      }
      const html = await res.text()
      return this.parse(html, limit)
    } catch (e) {
      clearTimeout(timer)
      this.lastError = e.name === 'AbortError' ? `超时（${this.timeoutMs}ms）` : e.message
      return []
    }
  }

  parse(html, limit = 10) {
    if (!html || !html.includes('result__a')) return []
    // 标题 + 真实链接
    const titleRe = /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g
    // 摘要（可能是 <a> 或 <div> 包裹）
    const snipRe = /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g

    const titles = []
    let m
    while ((m = titleRe.exec(html))) {
      const u = realUrl(m[1])
      if (u) titles.push({ url: u, title: stripHtml(m[2]) })
    }
    const snippets = []
    while ((m = snipRe.exec(html))) snippets.push(stripHtml(m[1]))

    return titles
      .map((t, i) => ({
        title: t.title,
        url: t.url,
        snippet: snippets[i] || '',
        domain: domainOf(t.url),
        publishedAt: null,
        engine: this.name
      }))
      .filter(r => r.url && r.title)
      .slice(0, limit)
  }
}
