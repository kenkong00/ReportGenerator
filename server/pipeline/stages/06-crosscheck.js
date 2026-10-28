import { systemBase } from '../../prompts/_common.js'
import { SCHEMAS } from '../../prompts/schemas.js'
import * as P from '../../prompts/index.js'
import * as rRepo from '../../db/repo/research.js'

/**
 * 交叉验证：规则优先识别冲突，LLM 只做裁决。
 * 这比"每个子问题都问一次 LLM"省约 30% 调用，且规则判定可解释、可回看。
 */

/** 从 claim / dataPoints 里抠数字，用于比较 */
function numericOf(text) {
  const m = String(text || '').match(/-?\d[\d,]*\.?\d*/g)
  if (!m) return null
  const cleaned = m.map(s => Number(s.replace(/,/g, ''))).filter(n => !isNaN(n))
  return cleaned.length ? Math.max(...cleaned.map(Math.abs)) : null
}

/** 规则判定两条证据是否冲突 */
function conflictOf(a, b) {
  if (!a.fact_key || !b.fact_key) return null
  if (a.fact_key !== b.fact_key) return null

  const na = numericOf(a.claim) ?? numericOf(a.data_json)
  const nb = numericOf(b.claim) ?? numericOf(b.data_json)
  if (na != null && nb != null && na > 0 && nb > 0) {
    const diff = Math.abs(na - nb) / Math.max(na, nb)
    if (diff > 0.05) {
      return { kind: 'numeric', detail: `${a.fact_key}：一方 ${na}，另一方 ${nb}，偏差 ${(diff * 100).toFixed(1)}%`, severity: diff > 0.3 ? 'high' : 'medium' }
    }
    return null
  }

  // 极性互斥
  if ((a.polarity === 'support' && b.polarity === 'refute') || (a.polarity === 'refute' && b.polarity === 'support')) {
    return { kind: 'polarity', detail: `${a.fact_key}：一方支持、一方反驳`, severity: 'high' }
  }
  return null
}

export async function run(ctx, input) {
  const evidences = rRepo.listEvidences(ctx.projectId, ctx.runId)
  const subQuestions = rRepo.listSubQuestions(ctx.projectId, ctx.runId)

  if (!evidences.length) {
    for (const sq of subQuestions) {
      rRepo.updateSubQuestion(sq.id, { status: 'unresolved', answer: '未找到可采信证据', confidence: 'disputed', answered_by_stage: 'crosscheck' })
    }
    return { ok: false, data: { conflicts: 0 }, warnings: ['没有证据可交叉验证'] }
  }

  ctx.progress(`对 ${evidences.length} 条证据做交叉验证…`)

  // ---- 1. 规则识别冲突 ----
  const conflicts = []
  const byKey = new Map()
  for (const e of evidences) {
    if (!e.fact_key) continue
    if (!byKey.has(e.fact_key)) byKey.set(e.fact_key, [])
    byKey.get(e.fact_key).push(e)
  }

  for (const [key, group] of byKey) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        // 同一 domain 不算独立来源
        if (group[i].domain === group[j].domain) continue
        const c = conflictOf(group[i], group[j])
        if (c) {
          conflicts.push({
            factKey: key,
            subQuestionId: group[i].sub_question_id || group[j].sub_question_id || null,
            topic: group[i].sub_question_id
              ? (subQuestions.find(s => s.id === group[i].sub_question_id)?.question || key)
              : key,
            a: group[i], b: group[j], ...c
          })
        }
      }
    }
  }

  // 去重：同一 fact_key + 同一 detail 只留一条
  const seen = new Set()
  const uniq = []
  for (const c of conflicts) {
    const k = `${c.factKey}|${c.a.id}|${c.b.id}`
    if (seen.has(k)) continue
    seen.add(k)
    uniq.push(c)
  }

  ctx.progress(`规则识别到 ${uniq.length} 处冲突`, uniq.length, uniq.length)

  // ---- 2. 对每个子问题回填简答（规则：取最高质量证据的 claim）----
  for (const sq of subQuestions) {
    const evs = evidences.filter(e => e.sub_question_id === sq.id)
    if (!evs.length) {
      rRepo.updateSubQuestion(sq.id, { status: 'unresolved', answer: '未找到可采信证据', confidence: 'disputed', answered_by_stage: 'crosscheck' })
      continue
    }
    const tierRank = { A: 0, B: 1, C: 2, U: 3, D: 4 }
    evs.sort((x, y) => (tierRank[x.authority_tier] ?? 5) - (tierRank[y.authority_tier] ?? 5))
    const best = evs[0]
    const hasConflict = uniq.some(c => c.subQuestionId === sq.id)
    rRepo.updateSubQuestion(sq.id, {
      status: 'answered',
      answer: best.claim,
      confidence: hasConflict ? 'disputed' : best.confidence,
      answered_by_stage: 'crosscheck'
    })
  }

  // ---- 3. LLM 裁决（只对冲突）----
  const disagreements = []
  if (uniq.length) {
    ctx.progress(`请模型裁决 ${uniq.length} 处冲突…`)
    const groups = uniq.map(c => ({
      subQuestionId: c.subQuestionId,
      question: c.topic,
      factKey: c.factKey,
      items: [c.a, c.b].map(e => ({
        id: e.id, claim: e.claim, confidence: e.confidence,
        stance: e.stance, dataPoints: safeJson(e.data_json, []),
        inferenceChain: e.inference_chain
      }))
    }))

    try {
      const messages = [
        { role: 'system', content: systemBase(ctx.tone, ctx.genre) },
        { role: 'user', content: P.crosscheckPrompt(groups, ctx.project.clarified_topic || ctx.project.raw_topic) }
      ]
      const { data } = await ctx.llm.json(messages, SCHEMAS.crosscheck, { purpose: 'json:crosscheck' })

      // 回填子问题的 LLM 裁决答案
      for (const a of data.answered || []) {
        if (a.subQuestionId) {
          rRepo.updateSubQuestion(a.subQuestionId, {
            status: a.unresolved ? 'unresolved' : 'answered',
            answer: a.answer, confidence: a.confidence, answered_by_stage: 'crosscheck'
          })
        }
      }

      for (const d of data.disagreements || []) {
        disagreements.push({
          subQuestionId: d.subQuestionId || null,
          factKey: d.factKey || null,
          topic: d.topic,
          positions: (d.positions || []).map(p => ({
            stance: p.stance, claim: p.claim,
            sourceIds: [], why: p.why || ''
          })),
          rootCause: d.rootCause,
          severity: d.severity || 'medium',
          adjudication: d.adjudication || 'unresolved',
          verdict: d.verdict || null
        })
      }
    } catch (e) {
      // LLM 裁决失败 → 保留规则判定，全部标 unresolved
      for (const c of uniq) {
        disagreements.push({
          subQuestionId: c.subQuestionId,
          factKey: c.factKey,
          topic: c.topic,
          positions: [
            { stance: '来源A', claim: c.a.claim, sourceIds: [c.a.source_id], why: c.a.domain },
            { stance: '来源B', claim: c.b.claim, sourceIds: [c.b.source_id], why: c.b.domain }
          ],
          rootCause: c.kind === 'numeric' ? '口径差异' : '利益立场',
          severity: c.severity,
          adjudication: 'unresolved',
          verdict: `规则识别：${c.detail}。模型裁决失败，保持未裁决。`
        })
      }
    }
  }

  // 补上规则识别到但 LLM 未覆盖的
  for (const c of uniq) {
    if (!disagreements.some(d => d.factKey === c.factKey && d.subQuestionId === c.subQuestionId)) {
      disagreements.push({
        subQuestionId: c.subQuestionId, factKey: c.factKey, topic: c.topic,
        positions: [
          { stance: '来源A', claim: c.a.claim, sourceIds: [c.a.source_id], why: c.a.domain },
          { stance: '来源B', claim: c.b.claim, sourceIds: [c.b.source_id], why: c.b.domain }
        ],
        rootCause: c.kind === 'numeric' ? '口径差异' : '利益立场',
        severity: c.severity, adjudication: 'unresolved',
        verdict: `规则识别：${c.detail}`
      })
    }
  }

  const saved = rRepo.replaceDisagreements(ctx.projectId, ctx.runId, disagreements)
  for (const d of saved) ctx.chunk('disagreement', d)

  const answered = subQuestions.filter(s => s.status === 'answered').length
  return {
    ok: true,
    data: {
      conflicts: uniq.length,
      disagreements: saved.length,
      answeredSubQuestions: answered,
      unresolved: subQuestions.length - answered,
      adjudicated: saved.filter(d => d.adjudication === 'adjudicated').length
    },
    warnings: uniq.length ? [`识别到 ${uniq.length} 处来源冲突，其中 ${saved.filter(d => d.adjudication === 'unresolved').length} 处未能裁决`] : []
  }
}

function safeJson(v, fb) {
  try { return JSON.parse(v) ?? fb } catch { return fb }
}
