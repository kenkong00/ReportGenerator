/**
 * Wikipedia 检索适配器 —— 零 key 免费知识源。
 *
 * 通过 MediaWiki API 检索词条，作为联网检索的"权威事实锚点"：
 * 适合概念定义、背景、数据口径类查询。中文 + 英文双语互补，扩大覆盖。
 */
import { domainOf } from '../../utils/text.js'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

function decodeEntities(s) {
  return String(s || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

function stripHtml(s) {
  return decodeEntities(String(s || '').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}

export class WikipediaAdapter {
  constructor(cfg = {}) {
    this.name = 'wikipedia'
    this.timeoutMs = cfg.timeoutMs ?? 15000
    this.requiresKey = false
    this.lastError = null
  }

  isAvailable() { return true }

  async search(query, { limit = 6, lang = 'zh', signal } = {}) {
    const langs = lang === 'en' ? ['en'] : ['zh', 'en']
    const per = Math.ceil(limit / langs.length) + 1
    const out = []
    const seen = new Set()

    for (const lg of langs) {
      const url = `https://${lg}.wikipedia.org/w/api.php?action=query&list=search` +
        `&srsearch=${encodeURIComponent(query)}&format=json&srlimit=${per}&utf8=1&srwhat=text&srprop=snippet`

      const ac = new AbortController()
      const timer = setTimeout(() => ac.abort(), this.timeoutMs)
      if (signal) signal.addEventListener('abort', () => ac.abort(), { once: true })
      try {
        const res = await fetch(url, {
          method: 'GET',
          redirect: 'follow',
          signal: ac.signal,
          headers: { 'User-Agent': UA, Accept: 'application/json' }
        })
        clearTimeout(timer)
        if (!res.ok) { this.lastError = `HTTP ${res.status}`; continue }
        const j = await res.json().catch(() => null)
        const items = j?.query?.search || []
        for (const it of items) {
          const title = it.title
          const url2 = `https://${lg}.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`
          if (seen.has(url2)) continue
          seen.add(url2)
          out.push({
            title,
            url: url2,
            snippet: stripHtml(it.snippet).slice(0, 400),
            domain: `${lg}.wikipedia.org`,
            publishedAt: null,
            engine: this.name
          })
          if (out.length >= limit) break
        }
      } catch (e) {
        clearTimeout(timer)
        this.lastError = e.name === 'AbortError' ? `超时（${this.timeoutMs}ms）` : e.message
      }
      if (out.length >= limit) break
    }
    return out
  }
}
