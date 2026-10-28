/**
 * 第二轮：短查询 + 权威源直抓正文，补齐可用证据。
 * 输出 ./.tmp/search-raw2.json
 */
import { BingRssAdapter } from '../search/adapters/bing-rss.js'
import { profile, freshness, relevance, quality } from '../search/domainAuthority.js'
import { fetchUrl } from '../search/fetcher.js'
import { extract } from '../search/extractor.js'
import fs from 'node:fs'
import path from 'node:path'

const QUERIES = [
  { sq: 'q1', q: '民政部 结婚登记 数据', limit: 8 },
  { sq: 'q1', q: '中国 结婚率 下降 原因', limit: 8 },
  { sq: 'q2', q: '出生人口 2024 954万', limit: 8 },
  { sq: 'q2', q: '总和生育率 中国 2024', limit: 8 },
  { sq: 'q4', q: '女研究生 占比 超过男生', limit: 8 },
  { sq: 'q4', q: '女性 高等教育 毛入学率', limit: 8 },
  { sq: 'q5', q: '女性劳动参与率 下降', limit: 8 },
  { sq: 'q6', q: '高价彩礼 治理 中央一号文件', limit: 8 },
  { sq: 'q8', q: '女性 就业 性别歧视 现状', limit: 8 },
  { sq: 'q9', q: '网络 性别对立 舆论 极化', limit: 8 },
  { sq: 'q10', q: '韩国 出生率 性别矛盾', limit: 8 },
  { sq: 'q11', q: '离婚率 上升 数据 民政', limit: 8 },
  { sq: 'q12', q: '单身人口 中国 规模', limit: 8 },
  { sq: 'q13', q: '女性 就业 生育 冲突 母职惩罚', limit: 8 }
]

// 权威源直抓目标
const PINNED = [
  { sq: 'q2', url: 'https://www.stats.gov.cn/sj/zxfb/202501/t20250117_1958330.html', note: '国家统计局 2024 年人口数据' },
  { sq: 'q1', url: 'https://www.stats.gov.cn/sj/sjjd/202402/t20240228_1947800.html', note: '统计局解读' },
  { sq: 'q0', url: 'https://www.gov.cn/zhengce/202309/content_6901288.htm', note: '妇女权益保障法' }
]

const ad = new BingRssAdapter({ count: 30 })
const out = { startedAt: new Date().toISOString(), queries: [], results: [], fetched: [] }
const seen = new Set()

for (const item of QUERIES) {
  const t0 = Date.now()
  const rs = await ad.search(item.q, { limit: item.limit, lang: 'zh' })
  const ms = Date.now() - t0
  out.queries.push({ ...item, ms, count: rs.length })
  process.stderr.write(`[${rs.length}条 ${ms}ms] ${item.q}\n`)
  for (const r of rs) {
    const key = r.url.replace(/\/$/, '')
    if (seen.has(key)) continue
    seen.add(key)
    const a = profile(r.domain)
    const fr = freshness(r.publishedAt, `${r.title} ${r.snippet}`)
    const rel = relevance(item.q, r.title, r.snippet)
    out.results.push({ ...r, ...a, freshness: fr, relevance: rel, quality: quality({ authorityScore: a.score, freshnessScore: fr, relevanceScore: rel, isPrimary: a.isPrimary }) })
  }
  await new Promise(r => setTimeout(r, 300))
}

// 直抓权威页
for (const p of PINNED) {
  try {
    const fr = await fetchUrl(p.url, { timeoutMs: 20000 })
    if (!fr.ok) { out.fetched.push({ ...p, ok: false, error: fr.error }); process.stderr.write(`[fetch FAIL ${fr.error}] ${p.url}\n`); continue }
    const ex = extract(fr.html, fr.finalUrl || p.url)
    out.fetched.push({ ...p, ok: true, len: (ex.text || '').length, title: ex.title || '', text: (ex.text || '').slice(0, 5000) })
    process.stderr.write(`[fetch ${(ex.text || '').length}字] ${p.url}\n`)
  } catch (e) {
    out.fetched.push({ ...p, ok: false, error: e.message })
    process.stderr.write(`[fetch ERR ${e.message}] ${p.url}\n`)
  }
}

const dir = path.join(process.cwd(), '.tmp')
fs.mkdirSync(dir, { recursive: true })
fs.writeFileSync(path.join(dir, 'search-raw2.json'), JSON.stringify(out, null, 2), 'utf8')

console.log('查询数:', out.queries.length, '去重来源:', out.results.length)
const byTier = {}
for (const r of out.results) byTier[r.tier] = (byTier[r.tier] || 0) + 1
console.log('权威分布:', JSON.stringify(byTier))
console.log('\n=== Top 25 ===')
;[...out.results].sort((a, b) => b.quality - a.quality).slice(0, 25).forEach((r, i) => {
  console.log(`${i + 1}. [${r.tier} ${r.quality.toFixed(2)}] ${r.domain} | ${(r.publishedAt || '').slice(0, 10)} | ${r.title.slice(0, 55)}`)
})
