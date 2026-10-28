/**
 * Bing 网页检索适配器（HTML 抓取，零 key）。
 *
 * 说明：Bing 的 format=rss 搜索源多年前已下线（旧 bing-rss.js 因此失效），
 * 但普通网页搜索 https://cn.bing.com/search 依然可用，实测能稳定返回真实结果。
 * 作为 DuckDuckGo 之外的第二通用引擎，显著提升来源多样性。
 * 关闭安全过滤（safeSearch=Off），内容尺度交由提示词层统一管理。
 */
import { httpGet, stripHtml, decodeEntities } from '../http.js'
import { domainOf } from '../../utils/text.js'

export class BingAdapter {
  constructor(cfg = {}) {
    this.name = 'bing'
    this.timeoutMs = cfg.timeoutMs ?? 15000
    this.requiresKey = false
    this.lastError = null
  }

  isAvailable() { return true }

  async search(query, { limit = 10, lang = 'zh', signal } = {}) {
    const q = encodeURIComponent(query)
    // setmkt=zh-CN 提升中文结果；safeSearch=Off 关闭安全过滤
    const url = `https://cn.bing.com/search?q=${q}&count=${Math.min(limit + 6, 30)}&setmkt=zh-CN&setlang=zh-CN&safeSearch=Off&ensearch=0`
    const r = await httpGet(url, { timeoutMs: this.timeoutMs, signal, headers: { Accept: 'text/html,application/xhtml+xml,*/*;q=0.8' } })
    if (!r.ok) { this.lastError = `HTTP ${r.status}${r.error ? ' ' + r.error : ''}`; return [] }
    return this.parse(r.text, limit)
  }

  parse(html, limit = 10) {
    if (!html || !html.includes('b_algo')) return []
    const items = []
    // 每个结果块：<li class="b_algo"> ... <h2><a href="URL">TITLE</a></h2> ... <p>SNIPPET</p>
    const blockRe = /<li class="b_algo"[\s\S]*?(?=<li class="b_algo"|<\/ol>|<\/main>|$)/g
    const blocks = html.match(blockRe) || []
    for (const b of blocks) {
      const a = b.match(/<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/)
      if (!a) continue
      const url = decodeEntities(a[1])
      if (!/^https?:/.test(url)) continue
      const title = stripHtml(a[2])
      let snippet = ''
      const p = b.match(/<p[^>]*>([\s\S]*?)<\/p>/)
      if (p) snippet = stripHtml(p[1])
      else {
        // 有些结果摘要在 .b_caption 或 .b_lineclamp 里
        const cap = b.match(/class="b_caption"[^>]*>([\s\S]*?)<\/div>/)
        if (cap) snippet = stripHtml(cap[1])
      }
      if (!title || !url) continue
      items.push({
        title, url, snippet: snippet.slice(0, 500),
        domain: domainOf(url), publishedAt: null, engine: this.name
      })
      if (items.length >= limit) break
    }
    return items
  }
}
