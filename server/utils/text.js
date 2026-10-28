import crypto from 'node:crypto'

/** URL 归一化：去 hash、去常见追踪参数、去末尾斜杠、协议/host 小写 */
export function normalizeUrl(url) {
  try {
    const u = new URL(url)
    u.hash = ''
    const drop = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
      'spm', 'from', 'share_token', 'ref', 'referrer', 'source', 'sid', 'timestamp', '_', 'callback']
    for (const k of [...u.searchParams.keys()]) {
      if (drop.includes(k.toLowerCase())) u.searchParams.delete(k)
    }
    u.hostname = u.hostname.toLowerCase()
    if (u.pathname.length > 1 && u.pathname.endsWith('/')) u.pathname = u.pathname.slice(0, -1)
    return u.toString()
  } catch {
    return url
  }
}

export function urlHash(url) {
  return crypto.createHash('sha1').update(normalizeUrl(url)).digest('hex')
}

export function domainOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

export function contentHash(text) {
  const t = (text || '').replace(/\s+/g, ' ').trim().slice(0, 4000)
  return crypto.createHash('sha1').update(t).digest('hex')
}

/** 截断到指定字数，优先在句号/分号处断开 */
export function truncate(text, maxChars = 800) {
  if (!text) return ''
  const t = String(text).replace(/\s+/g, ' ').trim()
  if (t.length <= maxChars) return t
  const cut = t.slice(0, maxChars)
  const p = Math.max(cut.lastIndexOf('。'), cut.lastIndexOf('；'), cut.lastIndexOf('. '))
  return (p > maxChars * 0.5 ? cut.slice(0, p + 1) : cut) + '…'
}

export function stripHtml(s) {
  return String(s || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 中文字数统计：中文按字、英文按词 */
export function wordCount(text) {
  if (!text) return 0
  const cn = (text.match(/[\u4e00-\u9fa5]/g) || []).length
  const en = (text.match(/[a-zA-Z]+/g) || []).length
  return cn + en
}

/** 粗估 token：中文 ~1.6 字/token，英文 ~4 字符/token */
export function estimateTokens(text) {
  if (!text) return 0
  const cn = (text.match(/[\u4e00-\u9fa5]/g) || []).length
  const rest = text.length - cn
  return Math.ceil(cn / 1.6 + rest / 4)
}

/** 提取正文里的 [[ev:12]] 引用 id */
export function extractEvidenceRefs(md) {
  const out = []
  const re = /\[\[ev:(\d+)\]\]/g
  let m
  while ((m = re.exec(md))) out.push(Number(m[1]))
  return [...new Set(out)]
}

/** 把不在 allowedIds 里的引用降级为 [?] */
export function sanitizeEvidenceRefs(md, allowedIds) {
  const allowed = new Set(allowedIds.map(Number))
  return md.replace(/\[\[ev:(\d+)\]\]/g, (full, id) => allowed.has(Number(id)) ? full : '[?]')
}

/** 统计「事实性句子里没挂引用的比例」——质量分用 */
export function uncoveredClaimRatio(md) {
  const sentences = String(md || '')
    .split(/[。！？\n]/)
    .map(s => s.trim())
    .filter(s => s.length > 12 && !/^[#>|*-]/.test(s) && !/\[\[ev:/.test(s))
  const withRef = String(md || '').match(/\[\[ev:\d+\]\]/g)?.length || 0
  if (sentences.length === 0) return 0
  return Math.max(0, 1 - withRef / sentences.length)
}

/** 从混杂文本里抽取年份（用于时效性判断） */
export function extractYear(text) {
  const m = String(text || '').match(/(19|20)\d{2}/g)
  return m ? Math.max(...m.map(Number)) : null
}

export function nowIso() {
  return new Date().toISOString()
}

export function j(v, fallback = null) {
  try { return JSON.parse(v) } catch { return fallback }
}
