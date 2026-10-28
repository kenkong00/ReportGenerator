/**
 * 一次性脚本：用系统真实检索通道，按「模拟流水线」的方式跑一遍选题检索。
 * 输出 JSON 到 ./.tmp/search-raw.json
 */
import { BingRssAdapter } from '../search/adapters/bing-rss.js'
import { profile, freshness, relevance, quality } from '../search/domainAuthority.js'
import fs from 'node:fs'
import path from 'node:path'

const QUERIES = [
  { sq: 'q1', q: '中国 结婚率 民政部 统计数据', lang: 'zh', limit: 8 },
  { sq: 'q1', q: '中国 离婚率 2024 民政部 统计', lang: 'zh', limit: 8 },
  { sq: 'q2', q: '中国 出生人口 国家统计局 2024 2025', lang: 'zh', limit: 8 },
  { sq: 'q3', q: '中国 总人口 性别比 七普 数据', lang: 'zh', limit: 6 },
  { sq: 'q4', q: '中国 高等教育 女性 占比 大学生 比例', lang: 'zh', limit: 8 },
  { sq: 'q5', q: '中国 女性 劳动参与率 数据 统计', lang: 'zh', limit: 8 },
  { sq: 'q6', q: '彩礼 现状 调查 农村 高价彩礼 治理', lang: 'zh', limit: 8 },
  { sq: 'q7', q: '妇女权益保障法 2023 修订 施行', lang: 'zh', limit: 6 },
  { sq: 'q8', q: '职场 性别歧视 调查 女性 就业 报告', lang: 'zh', limit: 8 },
  { sq: 'q9', q: '性别对立 舆论 研究 网络 性别议题', lang: 'zh', limit: 8 },
  { sq: 'q10', q: '韩国 性别冲突 低生育率 原因', lang: 'zh', limit: 8 },
  { sq: 'q11', q: '中国 家庭 育儿成本 报告 生育支持政策', lang: 'zh', limit: 8 },
  { sq: 'q12', q: 'gender polarization China social media feminism backlash', lang: 'en', limit: 6 },
  { sq: 'q13', q: 'South Korea gender war fertility rate 2024', lang: 'en', limit: 6 }
]

const ad = new BingRssAdapter({ count: 30 })
const out = { startedAt: new Date().toISOString(), queries: [], results: [] }
const seen = new Set()

const pLimit = (n) => new Promise(r => setTimeout(r, n))

for (const item of QUERIES) {
  const t0 = Date.now()
  const rs = await ad.search(item.q, { limit: item.limit, lang: item.lang })
  const ms = Date.now() - t0
  out.queries.push({ sq: item.sq, q: item.q, lang: item.lang, ms, count: rs.length, engine: ad.name })
  process.stderr.write(`[${item.lang}] ${rs.length} 条 ${ms}ms :: ${item.q}\n`)
  for (const r of rs) {
    const key = r.url.replace(/\/$/, '')
    if (seen.has(key)) continue
    seen.add(key)
    const auth = profile(r.domain)
    const fr = freshness(r.publishedAt, `${r.title} ${r.snippet}`)
    const rel = relevance(item.q, r.title, r.snippet)
    const qs = quality({ authorityScore: auth.score, freshnessScore: fr, relevanceScore: rel, isPrimary: auth.isPrimary })
    out.results.push({ ...r, sq: item.sq, ...auth, freshness: fr, relevance: rel, quality: qs })
  }
  await pLimit(350)
}

const dir = path.join(process.cwd(), '.tmp')
fs.mkdirSync(dir, { recursive: true })
fs.writeFileSync(path.join(dir, 'search-raw.json'), JSON.stringify(out, null, 2), 'utf8')

console.log('查询数:', out.queries.length)
console.log('去重后来源:', out.results.length)
const byTier = {}
for (const r of out.results) byTier[r.tier] = (byTier[r.tier] || 0) + 1
console.log('权威分布:', JSON.stringify(byTier))
const byDomain = {}
for (const r of out.results) byDomain[r.domain] = (byDomain[r.domain] || 0) + 1
console.log('Top 域名:', Object.entries(byDomain).sort((a, b) => b[1] - a[1]).slice(0, 20).map(x => x[0] + ':' + x[1]).join(', '))
