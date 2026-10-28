/**
 * 正文抽取：cheerio + 段落密度启发式。
 * 不引入 readability/linkedom —— 依赖太重，对中文站点收益有限。
 */
import * as cheerio from 'cheerio'

const NOISE_SELECTORS = [
  'script', 'style', 'noscript', 'iframe', 'svg', 'nav', 'header', 'footer',
  'aside', 'form', 'button', 'advertisement', '.ad', '.ads', '.advert',
  '.sidebar', '.nav', '.menu', '.footer', '.header', '.comment', '.comments',
  '.share', '.social', '.related', '.recommend', '.pagination', '.breadcrumb'
]

/**
 * @returns {{text:string, title:string, publishedAt:string|null, siteName:string|null}}
 */
export function extract(html, url = '') {
  if (!html) return { text: '', title: '', publishedAt: null, siteName: null }
  let $
  try { $ = cheerio.load(html, { decodeEntities: true }) } catch { return { text: '', title: '', publishedAt: null, siteName: null } }

  const title = ($('meta[property="og:title"]').attr('content') || $('title').text() || '').trim()
  const siteName = $('meta[property="og:site_name"]').attr('content') ||
    $('meta[name="application-name"]').attr('content') || null

  const publishedAt =
    $('meta[property="article:published_time"]').attr('content') ||
    $('meta[name="publishdate"]').attr('content') ||
    $('meta[name="pubdate"]').attr('content') ||
    $('meta[itemprop="datePublished"]').attr('content') ||
    $('time[datetime]').first().attr('datetime') ||
    null

  // 克隆一份再删噪声，避免破坏 metadata 查询
  try { $(NOISE_SELECTORS.join(',')).remove() } catch {}

  // 候选容器：article / main / 内容区 class / body
  const candidates = []
  const push = (sel, weight) => {
    try {
      $(sel).each((i, el) => {
        const t = normalize($(el).text())
        if (t.length > 100) candidates.push({ text: t, weight: weight + Math.min(t.length / 2000, 1.5) })
      })
    } catch {}
  }
  push('article', 3)
  push('main', 2.5)
  push('[class*="content"]', 1.5)
  push('[class*="article"]', 1.5)
  push('[id*="content"]', 1.5)
  push('[class*="post"]', 1)
  push('[class*="detail"]', 1)

  let text = ''
  if (candidates.length) {
    candidates.sort((a, b) => b.weight - a.weight)
    text = candidates[0].text
  } else {
    // 兜底：取所有 <p> 中最长的连续块
    const paras = []
    $('p').each((i, el) => {
      const t = normalize($(el).text())
      if (t.length > 20) paras.push(t)
    })
    text = paras.join('\n\n')
  }

  if (!text || text.length < 100) {
    text = normalize($('body').text())
  }

  return {
    text: text.slice(0, 20000),
    title: title.slice(0, 200),
    publishedAt: publishedAt ? safeIso(publishedAt) : null,
    siteName
  }
}

function normalize(s) {
  return String(s || '')
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\s+|\s+$/g, '')
}

function safeIso(v) {
  const d = new Date(v)
  return isNaN(d.getTime()) ? null : d.toISOString()
}
