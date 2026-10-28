/**
 * 国内搜索引擎适配器（百度 / 搜狗 / 360）—— 零 key 网页检索。
 *
 * 注意：这些站点有反爬，成败高度依赖本机网络与访问频率；因此：
 * - 每个适配器都尽力解析真实 URL（百度优先取 mu 属性 / 展示域名）；
 * - 失败就快速返回空，绝不拖垮整体（多引擎聚合时其它引擎照常）。
 * - 安全搜索一律关闭，内容尺度交由提示词层管理。
 */
import { httpGet, stripHtml, decodeEntities } from '../http.js'
import { domainOf } from '../../utils/text.js'

function safeHost(u) {
  try { return new URL(u).hostname } catch { return '' }
}

/** 跳转链/自家链 一律不算真实 URL（否则会把来源域名污染成搜索引擎自己的域名） */
function isRedirectLink(u) {
  return /baidu\.com\/link|sogou\.com\/link|so\.com\/link|\/link\?url=|^\/link/.test(u)
}

/** 从百度结果块里抠出真实 URL：优先 mu 属性，其次非跳转的直链 */
function realUrlFromBaidu(href, block) {
  const mu = block.match(/\smu="([^"]+)"/)
  if (mu && /^https?:/.test(mu[1]) && !isRedirectLink(mu[1])) return mu[1]
  if (href && /^https?:\/\//.test(href) && !isRedirectLink(href)) return href
  return null
}

export class BaiduAdapter {
  constructor(cfg = {}) { this.name = 'baidu'; this.timeoutMs = cfg.timeoutMs ?? 15000; this.requiresKey = false; this.lastError = null }
  isAvailable() { return true }
  async search(query, { limit = 10, signal } = {}) {
    const url = `https://www.baidu.com/s?wd=${encodeURIComponent(query)}&rn=${Math.min(limit + 6, 30)}&ie=utf-8&safe=off&usm=1`
    const r = await httpGet(url, { timeoutMs: this.timeoutMs, signal, referer: 'https://www.baidu.com/' })
    if (!r.ok) { this.lastError = `HTTP ${r.status}${r.error ? ' ' + r.error : ''}`; return [] }
    return this.parse(r.text, limit)
  }
  parse(html, limit = 10) {
    if (!html || !/result/.test(html)) return []
    const out = []
    const blockRe = /<div[^>]*class="result[^"]*"[\s\S]*?(?=<div[^>]*class="result|<\/div>\s*<\/div>\s*<\/div>|$)/g
    const blocks = html.match(blockRe) || []
    for (const b of blocks) {
      const a = b.match(/<h3[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/)
      if (!a) continue
      const title = stripHtml(a[2]); if (!title) continue
      const real = realUrlFromBaidu(decodeEntities(a[1]), b)
      if (!real) continue
      let snippet = ''
      const s = b.match(/class="c-abstract"[^>]*>([\s\S]*?)<\/div>/) || b.match(/class="content-right[^"]*"[^>]*>([\s\S]*?)<\/span>/)
      if (s) snippet = stripHtml(s[1])
      out.push({ title, url: real, snippet: snippet.slice(0, 500), domain: domainOf(real), publishedAt: null, engine: this.name })
      if (out.length >= limit) break
    }
    return out
  }
}

export class SogouAdapter {
  constructor(cfg = {}) { this.name = 'sogou'; this.timeoutMs = cfg.timeoutMs ?? 15000; this.requiresKey = false; this.lastError = null }
  isAvailable() { return true }
  async search(query, { limit = 10, signal } = {}) {
    const url = `https://www.sogou.com/web?query=${encodeURIComponent(query)}&num=${Math.min(limit + 6, 30)}`
    const r = await httpGet(url, { timeoutMs: this.timeoutMs, signal, referer: 'https://www.sogou.com/' })
    if (!r.ok) { this.lastError = `HTTP ${r.status}${r.error ? ' ' + r.error : ''}`; return [] }
    return this.parse(r.text, limit)
  }
  parse(html, limit = 10) {
    if (!html || !/vrwrap|class="rb"/.test(html)) return []
    const out = []
    const blocks = html.match(/<div[^>]*class="(?:vrwrap|rb)"[\s\S]*?(?=<div[^>]*class="(?:vrwrap|rb)"|$)/g) || []
    for (const b of blocks) {
      const a = b.match(/<h3[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/)
      if (!a) continue
      let href = decodeEntities(a[1])
      if (href.startsWith('//')) href = 'https:' + href
      if (href.startsWith('/')) href = 'https://www.sogou.com' + href
      if (isRedirectLink(href)) continue          // 丢弃跳转链，只保留真实页面
      const title = stripHtml(a[2]); if (!title || !/^https?:/.test(href)) continue
      if (/sogou\.com$/i.test(safeHost(href))) continue
      let snippet = ''
      const s = b.match(/class="(?:str_info|space-txt|fz-mid|text-layout[^"]*)"[^>]*>([\s\S]*?)<\/div>/)
      if (s) snippet = stripHtml(s[1])
      out.push({ title, url: href, snippet: snippet.slice(0, 500), domain: domainOf(href), publishedAt: null, engine: this.name })
      if (out.length >= limit) break
    }
    return out
  }
}

export class So360Adapter {
  constructor(cfg = {}) { this.name = 'so360'; this.timeoutMs = cfg.timeoutMs ?? 15000; this.requiresKey = false; this.lastError = null }
  isAvailable() { return true }
  async search(query, { limit = 10, signal } = {}) {
    const url = `https://www.so.com/s?q=${encodeURIComponent(query)}&pn=1&rn=${Math.min(limit + 6, 30)}`
    const r = await httpGet(url, { timeoutMs: this.timeoutMs, signal, referer: 'https://www.so.com/' })
    if (!r.ok) { this.lastError = `HTTP ${r.status}${r.error ? ' ' + r.error : ''}`; return [] }
    return this.parse(r.text, limit)
  }
  parse(html, limit = 10) {
    if (!html || !/res-list/.test(html)) return []
    const out = []
    const blocks = html.match(/<li[^>]*class="res-list[\s\S]*?(?=<li[^>]*class="res-list|$)/g) || []
    for (const b of blocks) {
      const a = b.match(/<h3[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/)
      if (!a) continue
      let href = decodeEntities(a[1])
      if (href.startsWith('//')) href = 'https:' + href
      if (isRedirectLink(href)) continue          // 丢弃跳转链
      const title = stripHtml(a[2]); if (!title || !/^https?:/.test(href)) continue
      if (/so\.com$/i.test(safeHost(href))) continue
      let snippet = ''
      const s = b.match(/class="res-desc"[^>]*>([\s\S]*?)<\/p>/) || b.match(/class="res-rich"[^>]*>([\s\S]*?)<\/div>/)
      if (s) snippet = stripHtml(s[1])
      out.push({ title, url: href, snippet: snippet.slice(0, 500), domain: domainOf(href), publishedAt: null, engine: this.name })
      if (out.length >= limit) break
    }
    return out
  }
}
