/**
 * Bing RSS 检索适配器 —— 零 key 兜底通道。
 * 实测：https://cn.bing.com/search?q=...&format=rss&count=30&setmkt=zh-CN
 * 返回干净 XML（title / link / description / pubDate），无验证码、无需 key。
 */
import { XMLParser } from 'fast-xml-parser'
import { domainOf } from '../../utils/text.js'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

/** RFC 822 → ISO 8601 */
function toIso(pub) {
  if (!pub) return null
  const d = new Date(pub)
  return isNaN(d.getTime()) ? null : d.toISOString()
}

function pick(v) {
  if (v == null) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'object') return String(v['#text'] ?? v.text ?? '')
  return String(v)
}

export class BingRssAdapter {
  constructor(cfg = {}) {
    this.name = 'bing-rss'
    this.market = cfg.market || 'zh-CN'
    this.count = cfg.count || 30
    this.timeoutMs = cfg.timeoutMs ?? 15000
    this.requiresKey = false
    this.lastError = null
  }

  isAvailable() { return true }

  async search(query, { limit = 10, lang = 'zh', signal } = {}) {
    const market = lang === 'en' ? 'en-US' : this.market
    const url = `https://cn.bing.com/search?q=${encodeURIComponent(query)}` +
      `&format=rss&count=${Math.min(this.count, Math.max(limit * 2, 20))}&setmkt=${market}`

    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), this.timeoutMs)
    if (signal) signal.addEventListener('abort', () => ac.abort(), { once: true })

    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': UA,
          Accept: 'application/rss+xml, application/xml, text/xml, */*',
          'Accept-Language': lang === 'en' ? 'en-US,en;q=0.9' : 'zh-CN,zh;q=0.9'
        },
        signal: ac.signal,
        redirect: 'follow'
      })
      clearTimeout(timer)
      if (!res.ok) {
        this.lastError = `HTTP ${res.status}`
        return []
      }
      const xml = await res.text()
      return this.parse(xml, limit)
    } catch (e) {
      clearTimeout(timer)
      this.lastError = e.message
      return []
    }
  }

  parse(xml, limit = 10) {
    if (!xml || !xml.includes('<item')) return []
    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', trimValues: true })
    let doc
    try { doc = parser.parse(xml) } catch { return [] }
    const channel = doc?.rss?.channel
    if (!channel) return []
    let items = channel.item
    if (!items) return []
    if (!Array.isArray(items)) items = [items]

    return items.slice(0, limit).map(it => {
      const link = pick(it.link) || pick(it.guid)
      return {
        title: cleanTitle(pick(it.title)),
        url: link,
        snippet: cleanSnippet(pick(it.description)),
        domain: domainOf(link),
        publishedAt: toIso(pick(it.pubDate)),
        engine: this.name
      }
    }).filter(r => r.url && r.title)
  }
}

function cleanTitle(s) {
  return String(s || '').replace(/\s+-\s+(必应|Bing)$/i, '').trim()
}

function cleanSnippet(s) {
  return String(s || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 600)
}
