import { systemBase } from '../../prompts/_common.js'
import { SCHEMAS } from '../../prompts/schemas.js'
import * as P from '../../prompts/index.js'
import * as rRepo from '../../db/repo/research.js'
import * as da from '../../search/domainAuthority.js'

/**
 * 来源权威评估：规则预打分 + LLM 批量复核。
 * LLM 只能把规则分往低了改，不能因为"看起来像官网"就给 A。
 */
const BATCH = 12

export async function run(ctx, input) {
  const sources = rRepo.listSources(ctx.projectId)
  const unevaluated = sources.filter(s => !s.quality_score && s.authority_tier === 'U')

  // 先用规则给已知域名打底（省调用）
  let ruleScored = 0
  for (const s of unevaluated) {
    const prof = da.profile(s.domain)
    if (prof.known) {
      const fresh = da.freshness(s.published_at, s.snippet)
      const relv = da.relevance(lastQueryFor(ctx, s.from_query_id), s.title, s.snippet)
      const q = da.quality({ authorityScore: prof.score, freshnessScore: fresh, relevanceScore: relv, isPrimary: prof.isPrimary })
      rRepo.updateSourceEval(s.id, {
        tier: prof.tier, authorityScore: prof.score, isPrimary: prof.isPrimary,
        freshnessScore: fresh, relevanceScore: relv, qualityScore: q,
        reason: `规则：${prof.note || prof.kind}`
      })
      ruleScored++
    }
  }

  const pending = rRepo.listSources(ctx.projectId).filter(s => !s.quality_score && s.authority_tier === 'U')

  if (!pending.length) {
    ctx.progress(`来源评估完成（规则打底 ${ruleScored} 条）`)
    return summarize(ctx, { ruleScored, llmScored: 0 })
  }

  ctx.progress(`评估 ${pending.length} 个未知来源的权威度…`)

  let llmScored = 0
  for (let i = 0; i < pending.length; i += BATCH) {
    const batch = pending.slice(i, i + BATCH)
    ctx.progress(`评估来源 ${Math.min(i + BATCH, pending.length)}/${pending.length}…`, Math.min(i + BATCH, pending.length), pending.length)

    const candidates = batch.map((s, idx) => ({
      idx, title: s.title, url: s.url, domain: s.domain, snippet: s.snippet
    }))

    try {
      const messages = [
        { role: 'system', content: systemBase(ctx.tone, ctx.genre) },
        { role: 'user', content: P.sourceEvalPrompt(candidates, ctx.project.clarified_topic || ctx.project.raw_topic, ctx.genre) }
      ]
      const { data } = await ctx.llm.json(messages, SCHEMAS.sourceEval, { purpose: 'json:sourceEval' })
      const evaluated = (data.evaluated || []).slice(0, batch.length)

      for (const e of evaluated) {
        const s = batch[e.idx]
        if (!s) continue
        const fresh = da.freshness(s.published_at, s.snippet)
        const relv = e.relevanceScore ?? da.relevance(lastQueryFor(ctx, s.from_query_id), s.title, s.snippet)
        const q = da.quality({
          authorityScore: e.authorityScore ?? 0.4, freshnessScore: fresh,
          relevanceScore: relv, isPrimary: e.isPrimary
        })
        rRepo.updateSourceEval(s.id, {
          tier: e.tier || 'U',
          authorityScore: e.authorityScore ?? 0.4,
          isPrimary: e.isPrimary ?? null,
          freshnessScore: fresh, relevanceScore: relv, qualityScore: q,
          reason: e.reason || ''
        })
        llmScored++
        ctx.chunk('sourceEval', { id: s.id, tier: e.tier, keep: e.keep, domain: s.domain })
      }
      // 漏评的按规则兜底
      for (const s of batch) {
        const cur = rRepo.getSource(s.id)
        if (!cur.quality_score) {
          rRepo.updateSourceEval(s.id, {
            tier: 'U', authorityScore: 0.4, isPrimary: null,
            freshnessScore: 0.5, relevanceScore: 0.5, qualityScore: 0.4, reason: 'LLM 未覆盖，按未知处理'
          })
        }
      }
    } catch (e) {
      for (const s of batch) {
        rRepo.updateSourceEval(s.id, {
          tier: 'U', authorityScore: 0.4, isPrimary: null,
          freshnessScore: 0.5, relevanceScore: 0.5, qualityScore: 0.4,
          reason: `评估失败，按未知处理：${String(e.message).slice(0, 80)}`
        })
      }
    }
  }

  return summarize(ctx, { ruleScored, llmScored })
}

function lastQueryFor(ctx, queryId) {
  if (!queryId) return ''
  try {
    const rows = rRepo.listQueries(ctx.projectId, ctx.runId)
    return rows.find(r => r.id === queryId)?.query || ''
  } catch { return '' }
}

function summarize(ctx, { ruleScored, llmScored }) {
  const all = rRepo.listSources(ctx.projectId)
  const by = {}
  for (const s of all) by[s.authority_tier] = (by[s.authority_tier] || 0) + 1
  const kept = all.filter(s => ['A', 'B', 'C'].includes(s.authority_tier)).length
  ctx.progress(`评估完成：共 ${all.length} 条来源，保留 ${kept} 条`, kept, all.length)
  return {
    ok: true,
    data: { total: all.length, kept, byTier: by, ruleScored, llmScored },
    warnings: kept === 0 ? ['没有留下任何可采信来源，报告将标注为"未联网"'] : []
  }
}
