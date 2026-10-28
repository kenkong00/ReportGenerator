import { q, one, run } from '../index.js'
import { wordCount } from '../../utils/text.js'

/* ---------------- report_sections ---------------- */

export function replaceSections(projectId, runId, items) {
  run('DELETE FROM report_sections WHERE run_id = ?', runId)
  const out = []
  items.forEach((it, i) => {
    const r = run(`INSERT INTO report_sections(project_id, run_id, ord, level, perspective_key, heading,
                   md, md_brief, md_deep, key_points_json, evidence_ids_json, unresolved_json, status,
                   tokens_prompt, tokens_completion)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      projectId, runId, i, it.level ?? 2, it.perspectiveKey || null, it.heading,
      it.md || '', it.mdBrief || null, it.mdDeep || null,
      it.keyPoints || [], it.evidenceIds || [], it.unresolved || [],
      it.status || 'draft', it.tokensPrompt || 0, it.tokensCompletion || 0)
    out.push({ ...it, id: Number(r.lastInsertRowid), ord: i })
  })
  return out
}

export function updateSection(id, patch) {
  const allowed = ['md', 'md_brief', 'md_deep', 'key_points_json', 'evidence_ids_json',
    'unresolved_json', 'status', 'audit_json', 'heading', 'tokens_prompt', 'tokens_completion']
  const sets = []
  const args = []
  for (const [k, v] of Object.entries(patch)) {
    if (!allowed.includes(k)) continue
    sets.push(`${k} = ?`)
    args.push(v)
  }
  if (!sets.length) return
  args.push(id)
  run(`UPDATE report_sections SET ${sets.join(', ')} WHERE id = ?`, ...args)
}

export function listSections(projectId, runId) {
  return q('SELECT * FROM report_sections WHERE project_id = ? AND run_id = ? ORDER BY ord', projectId, runId)
}

export function getSection(id) {
  return one('SELECT * FROM report_sections WHERE id = ?', id)
}

/* ---------------- reports ---------------- */

export function upsertReport({ projectId, runId, variant, title, subtitle, md, html = null,
  offlineNotice = null, knowledgeCutoff = null, stats = {}, quality = {} }) {
  run(`INSERT INTO reports(project_id, run_id, variant, title, subtitle, md, html, word_count,
       stats_json, offline_notice, knowledge_cutoff, quality_json, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?, datetime('now'))
       ON CONFLICT(project_id, run_id, variant) DO UPDATE SET
         title=excluded.title, subtitle=excluded.subtitle, md=excluded.md, html=excluded.html,
         word_count=excluded.word_count, stats_json=excluded.stats_json,
         offline_notice=excluded.offline_notice, knowledge_cutoff=excluded.knowledge_cutoff,
         quality_json=excluded.quality_json, created_at=datetime('now')`,
    projectId, runId, variant, title, subtitle, md, html, wordCount(md), stats, offlineNotice, knowledgeCutoff, quality)
  return getReport(projectId, runId, variant)
}

export function getReport(projectId, runId, variant) {
  return one('SELECT * FROM reports WHERE project_id = ? AND run_id = ? AND variant = ?', projectId, runId, variant)
}

export function listReports(projectId, runId) {
  return q('SELECT id, variant, title, word_count, created_at FROM reports WHERE project_id = ? AND run_id = ? ORDER BY variant', projectId, runId)
}

export function latestReports(projectId) {
  const run = one('SELECT id FROM runs WHERE project_id = ? ORDER BY seq DESC LIMIT 1', projectId)
  if (!run) return []
  return q('SELECT * FROM reports WHERE project_id = ? AND run_id = ?', projectId, run.id)
}
