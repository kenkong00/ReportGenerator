import { q, one, run } from '../index.js'

/* ---------------- sub_questions ---------------- */

export function replaceSubQuestions(projectId, runId, items) {
  run('DELETE FROM sub_questions WHERE run_id = ?', runId)
  const out = []
  for (const it of items) {
    const r = run(`INSERT INTO sub_questions(project_id, run_id, ord, question, qtype, expected_source_type,
                   perspective_key, priority, rationale, status)
                   VALUES (?,?,?,?,?,?,?,?,?, 'pending')`,
      projectId, runId, it.ord ?? 0, it.question, it.qtype || 'factual',
      it.expectedSourceType || 'media', it.perspectiveKey || null,
      it.priority ?? 2, it.rationale || '')
    out.push({ ...it, id: Number(r.lastInsertRowid) })
  }
  return out
}

export function listSubQuestions(projectId, runId) {
  return q('SELECT * FROM sub_questions WHERE project_id = ? AND run_id = ? ORDER BY ord, id', projectId, runId)
}

export function updateSubQuestion(id, patch) {
  const allowed = ['status', 'answer', 'confidence', 'answered_by_stage', 'priority']
  const sets = []
  const args = []
  for (const [k, v] of Object.entries(patch)) {
    if (!allowed.includes(k)) continue
    sets.push(`${k} = ?`)
    args.push(v)
  }
  if (!sets.length) return
  args.push(id)
  run(`UPDATE sub_questions SET ${sets.join(', ')} WHERE id = ?`, ...args)
}

/* ---------------- perspectives ---------------- */

export function replacePerspectives(projectId, runId, items) {
  run('DELETE FROM perspectives WHERE run_id = ?', runId)
  const out = []
  items.forEach((it, i) => {
    const r = run(`INSERT INTO perspectives(project_id, run_id, key, name, lens, key_metrics_json, ord, enabled)
                   VALUES (?,?,?,?,?,?,?,1)`,
      projectId, runId, it.key, it.name, it.lens, it.keyMetrics || [], i)
    out.push({ ...it, id: Number(r.lastInsertRowid), ord: i })
  })
  return out
}

export function listPerspectives(projectId, runId) {
  return q('SELECT * FROM perspectives WHERE project_id = ? AND run_id = ? ORDER BY ord', projectId, runId)
}

/* ---------------- search_queries ---------------- */

export function insertQuery({ projectId, runId, subQuestionId, perspectiveKey = null, query, lang = 'zh', engine }) {
  const r = run(`INSERT INTO search_queries(project_id, run_id, sub_question_id, perspective_key, query, lang, engine)
                 VALUES (?,?,?,?,?,?,?)`, projectId, runId, subQuestionId, perspectiveKey, query, lang, engine)
  return Number(r.lastInsertRowid)
}

export function updateQuery(id, patch) {
  const allowed = ['status', 'engine_used', 'results_count', 'error']
  const sets = []
  const args = []
  for (const [k, v] of Object.entries(patch)) {
    if (!allowed.includes(k)) continue
    sets.push(`${k} = ?`)
    args.push(v)
  }
  if (!sets.length) return
  args.push(id)
  run(`UPDATE search_queries SET ${sets.join(', ')} WHERE id = ?`, ...args)
}

export function listQueries(projectId, runId) {
  return q('SELECT * FROM search_queries WHERE project_id = ? AND run_id = ? ORDER BY id', projectId, runId)
}

export function clearQueries(runId) {
  run('DELETE FROM search_queries WHERE run_id = ?', runId)
}

/* ---------------- sources ---------------- */

export function upsertSource({ projectId, url, urlHash, title, snippet, domain, siteName = null,
  publishedAt = null, language = null, fromEngine = null, fromQueryId = null, runId = null }) {
  const existing = one('SELECT id, run_id FROM sources WHERE project_id = ? AND url_hash = ?', projectId, urlHash)
  if (existing) return { id: existing.id, dup: true, runId: existing.run_id }
  const r = run(`INSERT INTO sources(project_id, url, url_hash, title, snippet, domain, site_name,
                 published_at, language, from_engine, from_query_id, run_id)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    projectId, url, urlHash, title || '', snippet || '', domain || '', siteName, publishedAt, language, fromEngine, fromQueryId, runId)
  return { id: Number(r.lastInsertRowid), dup: false, runId }
}

export function updateSourceEval(id, { tier, authorityScore, isPrimary, freshnessScore, relevanceScore, qualityScore, reason }) {
  run(`UPDATE sources SET authority_tier=?, authority_score=?, is_primary=?, freshness_score=?,
       relevance_score=?, quality_score=?, eval_reason=? WHERE id=?`,
    tier, authorityScore ?? 0, isPrimary ?? null, freshnessScore ?? null, relevanceScore ?? null,
    qualityScore ?? null, reason || '', id)
}

export function updateSourceFetch(id, { status, error = null, fulltext = null, contentChars = 0, contentHash = null }) {
  run(`UPDATE sources SET fetch_status=?, fetch_error=?, fulltext=?, content_chars=?, content_hash=?,
       fetch_attempts = fetch_attempts + 1 WHERE id=?`,
    status, error, fulltext, contentChars, contentHash, id)
}

export function listSources(projectId, { onlyKept = false, minTier = null } = {}) {
  let sql = 'SELECT * FROM sources WHERE project_id = ?'
  const args = [projectId]
  if (minTier) {
    sql += ' AND authority_tier IN ('
    const tiers = { A: ['A'], B: ['A', 'B'], C: ['A', 'B', 'C'] }[minTier]
    sql += tiers.map(() => '?').join(',') + ')'
    args.push(...tiers)
  }
  sql += ` ORDER BY CASE authority_tier WHEN 'A' THEN 0 WHEN 'B' THEN 1 WHEN 'C' THEN 2 WHEN 'U' THEN 3 ELSE 4 END, quality_score DESC, id`
  return q(sql, ...args)
}

export function getSource(id) {
  return one('SELECT * FROM sources WHERE id = ?', id)
}

/** 已评估且决定保留的来源（按质量排序）。给了 runId 时，本轮新发现的来源优先（版本隔离）。 */
export function keptSources(projectId, limitOrOpts = 200, maybeRunId = null) {
  const opts = (typeof limitOrOpts === 'object' && limitOrOpts !== null)
    ? limitOrOpts
    : { limit: limitOrOpts, runId: maybeRunId }
  const limit = opts.limit || 200
  const runId = opts.runId || null
  if (runId) {
    return q(`SELECT * FROM sources WHERE project_id = ? AND authority_tier IN ('A','B','C')
              ORDER BY CASE WHEN run_id = ? THEN 0 ELSE 1 END,
                       CASE authority_tier WHEN 'A' THEN 0 WHEN 'B' THEN 1 ELSE 2 END,
                       COALESCE(quality_score,0) DESC, id LIMIT ?`, projectId, runId, limit)
  }
  return q(`SELECT * FROM sources WHERE project_id = ? AND authority_tier IN ('A','B','C')
            ORDER BY CASE authority_tier WHEN 'A' THEN 0 WHEN 'B' THEN 1 ELSE 2 END,
                     COALESCE(quality_score,0) DESC, id LIMIT ?`, projectId, limit)
}

export function markSourceInReport(id) {
  run('UPDATE sources SET in_report = 1 WHERE id = ?', id)
}

export function countSources(projectId) {
  return one('SELECT COUNT(*) c FROM sources WHERE project_id = ?', projectId)?.c || 0
}

/* ---------------- evidences ---------------- */

export function insertEvidence({ projectId, runId = null, sourceId, subQuestionId = null, perspectiveKey = null,
  claim, quote, quoteLocator = null, dataPoints = [], factKey = null, polarity = 'neutral',
  stance = null, confidence = 'medium', confidenceRule = null, confidenceLlm = null,
  confidenceReason = null, inference = 0, inferenceChain = null }) {
  const r = run(`INSERT INTO evidences(project_id, run_id, source_id, sub_question_id, perspective_key, claim, quote,
                 quote_locator, data_json, fact_key, polarity, stance, confidence,
                 confidence_rule, confidence_llm, confidence_reason, inference, inference_chain)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    projectId, runId, sourceId, subQuestionId, perspectiveKey, claim, quote, quoteLocator,
    dataPoints, factKey, polarity, stance, confidence, confidenceRule, confidenceLlm,
    confidenceReason, inference ? 1 : 0, inferenceChain)
  return Number(r.lastInsertRowid)
}

export function replaceEvidences(projectId, runId, items) {
  // 只清本轮抽取的证据（source 保留）
  if (runId) run('DELETE FROM evidences WHERE run_id = ?', runId)
  const out = []
  for (const it of items) {
    const id = insertEvidence({ ...it, projectId, runId })
    out.push({ ...it, id })
  }
  return out
}

/** 证据列表。给 runId 时只返回该版本（=该次运行）抽取的证据。 */
export function listEvidences(projectId, runId = null) {
  const base = `SELECT e.*, s.title AS source_title, s.url AS source_url, s.domain, s.authority_tier, s.published_at, s.snippet
                FROM evidences e JOIN sources s ON s.id = e.source_id
                WHERE e.project_id = ?`
  if (runId) return q(`${base} AND e.run_id = ? ORDER BY e.id`, projectId, runId)
  return q(`${base} ORDER BY e.id`, projectId)
}

/** 某个版本实际用到的来源（由其证据反推），用于报告页来源清单。 */
export function listSourcesForRun(projectId, runId) {
  if (!runId) return listSources(projectId)
  return q(`SELECT DISTINCT s.* FROM sources s
            JOIN evidences e ON e.source_id = s.id
            WHERE e.project_id = ? AND e.run_id = ?
            ORDER BY CASE s.authority_tier WHEN 'A' THEN 0 WHEN 'B' THEN 1 WHEN 'C' THEN 2 WHEN 'U' THEN 3 ELSE 4 END,
                     COALESCE(s.quality_score,0) DESC, s.id`, projectId, runId)
}

export function evidencesByIds(projectId, ids) {
  if (!ids?.length) return []
  const ph = ids.map(() => '?').join(',')
  return q(`SELECT e.*, s.title AS source_title, s.url AS source_url, s.domain, s.authority_tier, s.published_at
            FROM evidences e JOIN sources s ON s.id = e.source_id
            WHERE e.project_id = ? AND e.id IN (${ph})`, projectId, ...ids)
}

export function evidencesBySubQuestion(projectId, subQuestionId) {
  return q(`SELECT e.*, s.title AS source_title, s.url AS source_url, s.domain, s.authority_tier
            FROM evidences e JOIN sources s ON s.id = e.source_id
            WHERE e.project_id = ? AND e.sub_question_id = ? ORDER BY e.id`, projectId, subQuestionId)
}

export function evidencesByPerspective(projectId, perspectiveKey) {
  return q(`SELECT e.*, s.title AS source_title, s.url AS source_url, s.domain, s.authority_tier
            FROM evidences e JOIN sources s ON s.id = e.source_id
            WHERE e.project_id = ? AND e.perspective_key = ? ORDER BY e.id`, projectId, perspectiveKey)
}

export function markEvidenceUsed(id) {
  run('UPDATE evidences SET used_in_report = 1 WHERE id = ?', id)
}

/* ---------------- disagreements ---------------- */

export function replaceDisagreements(projectId, runId, items) {
  run('DELETE FROM disagreements WHERE run_id = ?', runId)
  const out = []
  items.forEach((it, i) => {
    const r = run(`INSERT INTO disagreements(project_id, run_id, sub_question_id, fact_key, topic,
                   positions_json, root_cause, severity, adjudication, adjudication_reason, verdict, ord)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      projectId, runId, it.subQuestionId || null, it.factKey || null, it.topic,
      it.positions || [], it.rootCause || null, it.severity || 'medium',
      it.adjudication || 'unresolved', it.adjudicationReason || null, it.verdict || null, i)
    out.push({ ...it, id: Number(r.lastInsertRowid), ord: i })
  })
  return out
}

export function listDisagreements(projectId, runId) {
  return q('SELECT * FROM disagreements WHERE project_id = ? AND run_id = ? ORDER BY ord', projectId, runId)
}
