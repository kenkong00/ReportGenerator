import { systemBase } from '../../prompts/_common.js'
import { SCHEMAS } from '../../prompts/schemas.js'
import * as P from '../../prompts/index.js'
import * as rRepo from '../../db/repo/research.js'
import * as secRepo from '../../db/repo/reports.js'
import { sanitizeEvidenceRefs, extractEvidenceRefs, j } from '../../utils/text.js'

/**
 * 大纲 + 逐节写作。
 * 核心：每节只喂「本节子问题 + 本节 ≤12 条证据 + 前序章节一句摘要」，绝不喂全文。
 */
const MAX_EV_PER_SECTION = 12

export async function run(ctx, input) {
  const topic = ctx.project.clarified_topic || ctx.project.raw_topic
  const perspectives = rRepo.listPerspectives(ctx.projectId, ctx.runId)
  const subQuestions = rRepo.listSubQuestions(ctx.projectId, ctx.runId)
  const evidences = rRepo.listEvidences(ctx.projectId, ctx.runId)

  // ---- 1. 大纲 ----
  ctx.progress('正在设计报告大纲…')
  let outline
  try {
    const messages = [
      { role: 'system', content: systemBase(ctx.tone, ctx.genre) },
      { role: 'user', content: P.outlinePrompt(topic, perspectives, subQuestions, ctx.mode, ctx.tone) }
    ]
    const { data } = await ctx.llm.json(messages, SCHEMAS.outline, {
      onDelta: d => ctx.think(d), purpose: 'json:outline'
    })
    outline = data
  } catch (e) {
    // 兜底大纲：按视角铺开（"分歧地图""局限"由装配层自动拼装，这里不要重复生成）
    outline = {
      title: topic,
      sections: perspectives.map(p => ({ heading: `${p.name}`, purpose: p.lens, level: 2, perspectiveKey: p.key }))
    }
  }

  const sections = (outline.sections || []).slice(0, ctx.caps.sections)
  ctx.progress(`大纲确定：${sections.length} 节`)

  // ---- 2. 逐节写作 ----
  const written = []
  const priorSummaries = []

  for (let i = 0; i < sections.length; i++) {
    const sec = sections[i]
    ctx.progress(`写作 ${i + 1}/${sections.length}：${sec.heading}`, i + 1, sections.length)

    const secEvs = pickEvidences(evidences, sec, subQuestions, perspectives, ctx.caps.evPerSection)
    const secSqs = pickSubQuestions(subQuestions, sec)

    const messages = [
      { role: 'system', content: systemBase(ctx.tone, ctx.genre) },
      {
        role: 'user',
        content: P.sectionPrompt(sec, {
          topic,
          subQuestions: secSqs,
          evidences: secEvs,
          priorSummaries,
          mode: ctx.mode,
          tone: ctx.tone
        })
      }
    ]

    try {
      const { data, usage } = await ctx.llm.json(messages, SCHEMAS.sectionWrite, {
        onDelta: d => ctx.think(d),
        purpose: `json:section:${sec.heading.slice(0, 12)}`,
        reserveTokens: 4000
      })

      const allowIds = secEvs.map(e => e.id)
      const cleanMd = sanitizeEvidenceRefs(data.md || '', allowIds)
      const refs = extractEvidenceRefs(cleanMd)

      written.push({
        ord: i,
        level: sec.level ?? 2,
        perspectiveKey: sec.perspectiveKey || null,
        heading: sec.heading,
        md: cleanMd,
        keyPoints: (data.keyPoints || []).slice(0, 5),
        evidenceIds: refs.length ? refs : allowIds.slice(0, 5),
        unresolved: data.unresolved || [],
        status: 'written',
        tokensPrompt: usage?.promptTokens || 0,
        tokensCompletion: usage?.completionTokens || 0
      })

      priorSummaries.push(`${sec.heading}：${(data.keyPoints || [])[0] || (data.md || '').slice(0, 60)}`)

      ctx.chunk('section', { ord: i, heading: sec.heading, refs: refs.length, keyPoints: (data.keyPoints || []).length })
    } catch (e) {
      // 单节失败：保留一个诚实占位，不让整份报告崩掉
      written.push({
        ord: i,
        level: sec.level ?? 2,
        perspectiveKey: sec.perspectiveKey || null,
        heading: sec.heading,
        md: `关于「${sec.heading}」，本节生成失败（${String(e.message).slice(0, 80)}）。可能是模型限流或上下文超限，可在过程时间线查看原始错误。`,
        keyPoints: [],
        evidenceIds: [],
        unresolved: [String(e.message).slice(0, 120)],
        status: 'draft',
        tokensPrompt: 0,
        tokensCompletion: 0
      })
      ctx.chunk('sectionError', { ord: i, heading: sec.heading, error: String(e.message).slice(0, 120) })
    }
  }

  const saved = secRepo.replaceSections(ctx.projectId, ctx.runId, written)

  // 标记用到的证据与来源
  for (const s of saved) {
    for (const id of j(s.evidence_ids_json, [])) {
      try { rRepo.markEvidenceUsed(id) } catch {}
    }
  }

  return {
    ok: saved.length > 0,
    data: {
      title: outline.title || topic,
      sections: saved.length,
      evidencesReferenced: saved.reduce((n, s) => n + j(s.evidence_ids_json, []).length, 0)
    },
    warnings: []
  }
}

/** 为某节挑选证据：优先该视角 + 该节子问题，其次按权威度 */
function pickEvidences(evidences, sec, subQuestions, perspectives, cap = MAX_EV_PER_SECTION) {
  const sqIds = new Set((sec.subQuestionIds || []).map(Number))
  const tierRank = { A: 0, B: 1, C: 2, U: 3, D: 4 }

  let pool = evidences
  if (sqIds.size) {
    const hit = evidences.filter(e => e.sub_question_id && sqIds.has(e.sub_question_id))
    if (hit.length) pool = hit
  }
  if (sec.perspectiveKey) {
    const byP = pool.filter(e => e.perspective_key === sec.perspectiveKey)
    if (byP.length >= 3) pool = byP
  }

  return [...pool]
    .sort((a, b) => (tierRank[a.authority_tier] ?? 5) - (tierRank[b.authority_tier] ?? 5))
    .slice(0, cap)
    .map(e => ({
      id: e.id, claim: e.claim, quote: e.quote,
      source_title: e.source_title, domain: e.domain, authority_tier: e.authority_tier,
      confidence: e.confidence, inference: e.inference, inference_chain: e.inference_chain,
      data_points: j(e.data_json, [])
    }))
}

function pickSubQuestions(subQuestions, sec) {
  if (sec.subQuestionIds?.length) {
    const ids = new Set(sec.subQuestionIds.map(Number))
    const hit = subQuestions.filter(s => ids.has(s.id))
    if (hit.length) return hit
  }
  if (sec.perspectiveKey) {
    const hit = subQuestions.filter(s => s.perspective_key === sec.perspectiveKey)
    if (hit.length) return hit
  }
  return subQuestions.slice(0, 5)
}
