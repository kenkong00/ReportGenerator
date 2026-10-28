import * as dp from '../db/repo/domainProfiles.js'
import { domainOf, extractYear } from '../utils/text.js'

const TIER_BASE = { A: 0.9, B: 0.72, C: 0.45, D: 0.15, U: 0.4 }

/**
 * 域名 → 权威画像。用户自定义优先于内置。
 * @returns {{tier, score, kind, isPrimary, note, known}}
 */
export function profile(domain) {
  if (!domain) return { tier: 'U', score: 0.4, kind: 'other', isPrimary: null, note: '无域名', known: false }
  const row = dp.lookup(domain)
  if (!row) return { tier: 'U', score: 0.4, kind: 'other', isPrimary: null, note: '未知域名', known: false }
  return {
    tier: row.tier,
    score: row.score ?? TIER_BASE[row.tier] ?? 0.4,
    kind: row.kind,
    isPrimary: row.is_primary_default ?? (row.tier === 'A' ? 1 : 0),
    note: row.note || '',
    known: true
  }
}

/** 时效性打分：越新越高；无日期给 0.5 */
export function freshness(publishedAt, text = '') {
  const now = new Date()
  let y = null
  if (publishedAt) {
    const d = new Date(publishedAt)
    if (!isNaN(d.getTime())) y = d.getFullYear()
  }
  if (y == null) y = extractYear(text)
  if (y == null) return 0.5
  const age = now.getFullYear() - y
  if (age <= 0) return 1.0
  if (age === 1) return 0.85
  if (age === 2) return 0.7
  if (age === 3) return 0.55
  if (age <= 5) return 0.4
  return 0.25
}

/** 相关度：查询词在标题/摘要里的命中率（简易 BM） */
export function relevance(query, title = '', snippet = '') {
  const terms = String(query || '').split(/\s+/).filter(t => t.length >= 2)
  if (!terms.length) return 0.5
  const hay = `${title} ${snippet}`.toLowerCase()
  let hit = 0
  for (const t of terms) {
    if (hay.includes(t.toLowerCase())) hit++
  }
  return Math.min(1, hit / terms.length)
}

/** 综合质量分 */
export function quality({ authorityScore = 0.5, freshnessScore = 0.5, relevanceScore = 0.5, isPrimary = 0 }) {
  return Number((
    authorityScore * 0.45 +
    relevanceScore * 0.35 +
    freshnessScore * 0.15 +
    (isPrimary ? 0.05 : 0)
  ).toFixed(3))
}

/** 规则算置信度（规则值权威，LLM 只能建议降级） */
export function confidenceRule({ tier, isPrimary, independentCount, freshnessScore, hasConflict }) {
  if (hasConflict) return { confidence: 'disputed', reason: '存在来源冲突且无权威裁决' }
  const n = independentCount || 1
  if (tier === 'A') {
    if (n >= 2) return { confidence: 'high', reason: `${n} 个独立 A 级来源一致` }
    if (freshnessScore < 0.4) return { confidence: 'low', reason: 'A 级来源但数据过时' }
    return { confidence: 'medium', reason: '单一 A 级来源' }
  }
  if (tier === 'B') {
    if (n >= 2) return { confidence: 'medium', reason: `${n} 个 B 级来源一致` }
    return { confidence: 'low', reason: '单一 B 级来源' }
  }
  if (tier === 'C') {
    if (n >= 2) return { confidence: 'low', reason: `${n} 个 C 级来源一致，仍需交叉验证` }
    return { confidence: 'disputed', reason: '仅单一 C 级来源' }
  }
  return { confidence: 'disputed', reason: '来源权威度未知或过低' }
}

export { domainOf }
