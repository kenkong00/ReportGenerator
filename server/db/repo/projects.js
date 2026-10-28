import { q, one, run, tx } from '../index.js'
import { v4 as uuid } from 'uuid'

/* ---------------- projects ---------------- */

export function createProject({ title, rawTopic, mode = 'standard', genre = 'auto', language = 'zh', budget = {}, options = {} }) {
  const id = uuid()
  run(`INSERT INTO projects(id, title, raw_topic, mode, genre, language, budget_json, options_json, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft')`,
    id, title || rawTopic, rawTopic, mode, genre || 'auto', language, budget, options)
  return getProject(id)
}

export function getProject(id) {
  return one('SELECT * FROM projects WHERE id = ? AND (deleted_at IS NULL)', id)
}

export function listProjects({ limit = 50, offset = 0, keyword = '' } = {}) {
  const V = `(SELECT COUNT(*) FROM runs r WHERE r.project_id = p.id) AS version_count`
  const rows = keyword
    ? q(`SELECT p.*, ${V} FROM projects p WHERE p.deleted_at IS NULL AND (p.title LIKE ? OR p.raw_topic LIKE ?)
         ORDER BY p.updated_at DESC LIMIT ? OFFSET ?`, `%${keyword}%`, `%${keyword}%`, limit, offset)
    : q(`SELECT p.*, ${V} FROM projects p WHERE p.deleted_at IS NULL ORDER BY p.updated_at DESC LIMIT ? OFFSET ?`, limit, offset)
  return rows.map(withEffectiveStatus)
}

/** 项目自身状态可能与最新 run 不一致（历史遗留），以 run 为准展示 */
export function withEffectiveStatus(p) {
  if (p.status !== 'running') return p
  const r = one('SELECT status FROM runs WHERE id = ?', p.current_run_id)
  if (!r || r.status === 'running') return p
  return { ...p, status: r.status }
}

export function updateProject(id, patch) {
  const allowed = ['title', 'clarified_topic', 'status', 'mode', 'genre', 'current_run_id', 'options_json', 'budget_json']
  const sets = []
  const args = []
  for (const [k, v] of Object.entries(patch)) {
    if (!allowed.includes(k)) continue
    sets.push(`${k} = ?`)
    args.push(v)
  }
  if (!sets.length) return getProject(id)
  args.push(id)
  run(`UPDATE projects SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ?`, ...args)
  return getProject(id)
}

export function softDeleteProject(id) {
  run(`UPDATE projects SET deleted_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`, id)
}

/* ---------------- runs ---------------- */

export function createRun(projectId, { trigger = 'manual', fromStage = null } = {}) {
  const seq = (one('SELECT MAX(seq) m FROM runs WHERE project_id = ?', projectId)?.m || 0) + 1
  const id = uuid()
  run(`INSERT INTO runs(id, project_id, seq, trigger, from_stage, status) VALUES (?, ?, ?, ?, ?, 'running')`,
    id, projectId, seq, trigger, fromStage)
  run(`UPDATE projects SET current_run_id = ?, status = 'running', updated_at = datetime('now') WHERE id = ?`, id, projectId)
  return one('SELECT * FROM runs WHERE id = ?', id)
}

export function getRun(id) {
  return one('SELECT * FROM runs WHERE id = ?', id)
}

export function latestRun(projectId) {
  return one('SELECT * FROM runs WHERE project_id = ? ORDER BY seq DESC LIMIT 1', projectId)
}

export function updateRun(id, patch) {
  const allowed = ['status', 'current_stage', 'last_error', 'stats_json', 'finished_at']
  const sets = []
  const args = []
  for (const [k, v] of Object.entries(patch)) {
    if (!allowed.includes(k)) continue
    sets.push(`${k} = ?`)
    args.push(v)
  }
  if (!sets.length) return getRun(id)
  args.push(id)
  run(`UPDATE runs SET ${sets.join(', ')} WHERE id = ?`, ...args)
  return getRun(id)
}

export function finishRun(id, status, stats = {}) {
  return updateRun(id, { status, finished_at: new Date().toISOString(), stats_json: stats })
}

export function listRuns(projectId) {
  return q('SELECT * FROM runs WHERE project_id = ? ORDER BY seq DESC', projectId)
}

/** 孤儿 run 清理：进程重启后把还在 running 的标为 aborted */
export function markOrphansAborted() {
  const r = run(`UPDATE runs SET status='aborted', last_error='进程重启，任务中断', finished_at=datetime('now')
                 WHERE status='running'`)
  return r.changes
}

/** 以最新 run 的真实状态校正项目状态（避免界面永远显示「进行中」） */
export function syncAllProjectStatus() {
  const rows = q(`SELECT p.id, r.status rs
                  FROM projects p JOIN runs r ON r.id = p.current_run_id
                  WHERE p.deleted_at IS NULL AND p.status <> r.status`)
  const map = { running: 'running', succeeded: 'succeeded', failed: 'failed', paused: 'paused', aborted: 'aborted' }
  let n = 0
  for (const r of rows) {
    const st = map[r.rs] || (r.rs === 'succeeded' ? 'done' : r.rs)
    run(`UPDATE projects SET status = ?, updated_at = datetime('now') WHERE id = ?`, st, r.id)
    n++
  }
  return n
}

/* ---------------- versions（版本 = 一次运行 run） ---------------- */

/** 一个项目的版本清单：每版的 seq / 状态 / 报告字数 / 证据数 / 是否当前版 */
export function listVersions(projectId) {
  const p = getProject(projectId)
  const runs = q('SELECT * FROM runs WHERE project_id = ? ORDER BY seq ASC', projectId)
  return runs.map(r => {
    const rep = one(`SELECT variant, title, word_count, created_at FROM reports
                     WHERE project_id = ? AND run_id = ?
                     ORDER BY CASE variant WHEN 'standard' THEN 0 WHEN 'brief' THEN 1 ELSE 2 END LIMIT 1`,
      projectId, r.id)
    const ev = one('SELECT COUNT(*) c FROM evidences WHERE project_id = ? AND run_id = ?', projectId, r.id)?.c || 0
    const src = one('SELECT COUNT(DISTINCT source_id) c FROM evidences WHERE project_id = ? AND run_id = ?', projectId, r.id)?.c || 0
    return {
      runId: r.id, seq: r.seq, status: r.status, trigger: r.trigger,
      currentStage: r.current_stage, startedAt: r.started_at, finishedAt: r.finished_at,
      lastError: r.last_error || null,
      isCurrent: !!p && p.current_run_id === r.id,
      title: rep?.title || null, wordCount: rep?.word_count || 0,
      reportAt: rep?.created_at || null, evidenceCount: ev, sourceCount: src
    }
  })
}

/**
 * 删除某个版本（该次运行）及其全部 run 级数据。
 * 共享来源池（sources）里属于该项目其它版本的来源会保留；
 * 只清理"本次发现、且已无任何证据引用"的孤儿来源。
 */
export function deleteRun(projectId, runId) {
  const r = getRun(runId)
  if (!r || r.project_id !== projectId) return { ok: false, error: '版本不存在' }
  tx(() => {
    run('DELETE FROM evidences WHERE project_id = ? AND run_id = ?', projectId, runId)
    run(`DELETE FROM sources WHERE project_id = ? AND run_id = ?
         AND id NOT IN (SELECT DISTINCT source_id FROM evidences)`, projectId, runId)
    run('DELETE FROM report_sections WHERE run_id = ?', runId)
    run('DELETE FROM reports WHERE run_id = ?', runId)
    run('DELETE FROM disagreements WHERE run_id = ?', runId)
    run('DELETE FROM search_queries WHERE run_id = ?', runId)
    run('DELETE FROM sub_questions WHERE run_id = ?', runId)
    run('DELETE FROM perspectives WHERE run_id = ?', runId)
    run('DELETE FROM stage_events WHERE run_id = ?', runId)
    run('DELETE FROM llm_calls WHERE run_id = ?', runId)
    run('DELETE FROM stages WHERE run_id = ?', runId)
    run('DELETE FROM clarify_qa WHERE asked_run_id = ?', runId)
    run('DELETE FROM runs WHERE id = ?', runId)
  })
  const p = getProject(projectId)
  const remaining = one('SELECT COUNT(*) c FROM runs WHERE project_id = ?', projectId)?.c || 0
  if (p && p.current_run_id === runId) {
    const next = one('SELECT id, status FROM runs WHERE project_id = ? ORDER BY seq DESC LIMIT 1', projectId)
    run(`UPDATE projects SET current_run_id = ?, status = ?, updated_at = datetime('now') WHERE id = ?`,
      next?.id || null, next?.status || 'draft', projectId)
  }
  return { ok: true, remaining }
}

/** 把某个版本设为"当前版本"（报告页默认打开它） */
export function activateRun(projectId, runId) {
  const r = getRun(runId)
  if (!r || r.project_id !== projectId) return null
  run(`UPDATE projects SET current_run_id = ?, status = ?, updated_at = datetime('now') WHERE id = ?`,
    runId, r.status, projectId)
  return getProject(projectId)
}

/* ---------------- clarify_qa ---------------- */

export function saveClarifyQuestions(projectId, questions, runId = null) {
  run('DELETE FROM clarify_qa WHERE project_id = ? AND answer IS NULL', projectId)
  for (const item of questions) {
    run(`INSERT INTO clarify_qa(project_id, question, options_json, asked_run_id) VALUES (?, ?, ?, ?)`,
      projectId, item.q, item.options || [], runId)
  }
}

export function listClarify(projectId) {
  return q('SELECT * FROM clarify_qa WHERE project_id = ? ORDER BY id', projectId)
}

export function answerClarify(id, answer, skipped = false) {
  run(`UPDATE clarify_qa SET answer = ?, skipped = ?, answered_at = datetime('now') WHERE id = ?`,
    answer, skipped ? 1 : 0, id)
}

export function pendingClarify(projectId) {
  return q('SELECT * FROM clarify_qa WHERE project_id = ? AND answer IS NULL AND skipped = 0 ORDER BY id', projectId)
}
