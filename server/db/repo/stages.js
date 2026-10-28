import { q, one, run, tx } from '../index.js'

/* ---------------- stages ---------------- */

export function upsertStage({ runId, projectId, stageKey, stageIndex, title, status = 'pending' }) {
  const id = `${runId}:${stageKey}`
  run(`INSERT INTO stages(id, run_id, project_id, stage_key, stage_index, title, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET status=excluded.status, title=excluded.title,
         stage_index=excluded.stage_index, attempt=stages.attempt`,
    id, runId, projectId, stageKey, stageIndex, title, status)
  return id
}

export function startStage(runId, stageKey) {
  run(`UPDATE stages SET status='running', started_at=datetime('now'),
       attempt = attempt + 1, error = NULL WHERE id = ?`, `${runId}:${stageKey}`)
}

export function finishStage(runId, stageKey, { status = 'succeeded', output = null, summary = '', error = null, usage = {} } = {}) {
  run(`UPDATE stages SET status=?, output_json=?, summary=?, error=?,
       finished_at=datetime('now'),
       duration_ms = COALESCE(duration_ms,0) + CAST((julianday('now') - julianday(started_at)) * 86400000 AS INTEGER),
       tokens_prompt = tokens_prompt + ?,
       tokens_completion = tokens_completion + ?,
       llm_calls = llm_calls + ?,
       searches = searches + ?,
       fetches = fetches + ?
       WHERE id = ?`,
    status, output ? JSON.stringify(output) : null, summary, error,
    usage.promptTokens || 0, usage.completionTokens || 0, usage.llmCalls || 0,
    usage.searches || 0, usage.fetches || 0,
    `${runId}:${stageKey}`)
}

export function setStageInput(runId, stageKey, input) {
  run('UPDATE stages SET input_json = ? WHERE id = ?', JSON.stringify(input), `${runId}:${stageKey}`)
}

export function addUsage(runId, stageKey, { promptTokens = 0, completionTokens = 0, llmCalls = 0, searches = 0, fetches = 0 } = {}) {
  run(`UPDATE stages SET
         tokens_prompt = tokens_prompt + ?,
         tokens_completion = tokens_completion + ?,
         llm_calls = llm_calls + ?,
         searches = searches + ?,
         fetches = fetches + ?
       WHERE id = ?`,
    promptTokens, completionTokens, llmCalls, searches, fetches, `${runId}:${stageKey}`)
}

export function getStage(runId, stageKey) {
  return one('SELECT * FROM stages WHERE id = ?', `${runId}:${stageKey}`)
}

export function listStages(runId) {
  return q('SELECT * FROM stages WHERE run_id = ? ORDER BY stage_index', runId)
}

/** 把某阶段及其之后的所有阶段置为待跑（用于「重跑本阶段」） */
export function resetFrom(runId, stageKey) {
  const idx = one('SELECT stage_index i FROM stages WHERE run_id = ? AND stage_key = ?', runId, stageKey)?.i
  if (idx == null) return 0
  return run(`UPDATE stages SET status = 'pending' WHERE run_id = ? AND stage_index >= ?`, runId, idx).changes
}

/** 把中断时残留的 running 阶段改判为 paused（下次续跑会重跑它） */
export function resetRunningStages(runId, status = 'paused') {
  return run(`UPDATE stages SET status = ? WHERE run_id = ? AND status IN ('running', 'pending')`, status, runId).changes
}

export function succeededStageKeys(runId) {
  return q('SELECT stage_key FROM stages WHERE run_id = ? AND status = ?', runId, 'succeeded').map(r => r.stage_key)
}

/* ---------------- stage_events ---------------- */

let seqCounter = null

export function emit({ runId, projectId, stageKey = null, type, payload = {} }) {
  const r = run(`INSERT INTO stage_events(run_id, project_id, stage_key, type, payload_json)
                 VALUES (?, ?, ?, ?, ?)`, runId, projectId, stageKey, type, payload)
  const seq = Number(r.lastInsertRowid)
  if (seqCounter) seqCounter.value = seq
  return seq
}

/** 供 SSE 直接拿到刚写入的 seq（避免再查一次） */
export function lastSeq() {
  return one('SELECT MAX(seq) s FROM stage_events')?.s || 0
}

export function eventsSince(runId, sinceSeq = 0, limit = 500) {
  return q('SELECT * FROM stage_events WHERE run_id = ? AND seq > ? ORDER BY seq LIMIT ?', runId, sinceSeq, limit)
}

export function listEvents(runId, { limit = 300, types = null } = {}) {
  if (types && types.length) {
    const ph = types.map(() => '?').join(',')
    return q(`SELECT * FROM stage_events WHERE run_id = ? AND type IN (${ph}) ORDER BY seq LIMIT ?`, runId, ...types, limit)
  }
  return q('SELECT * FROM stage_events WHERE run_id = ? ORDER BY seq LIMIT ?', runId, limit)
}

export function countEvents(runId) {
  return one('SELECT COUNT(*) c FROM stage_events WHERE run_id = ?', runId)?.c || 0
}

/* ---------------- llm_calls ---------------- */

export function logLlmCall({ runId, projectId, stageKey, provider, model, purpose,
  promptChars = 0, promptTokens = 0, completionChars = 0, completionTokens = 0,
  latencyMs = 0, ok = 1, errorCode = null, error = null }) {
  run(`INSERT INTO llm_calls(run_id, project_id, stage_key, provider, model, purpose,
       prompt_chars, prompt_tokens, completion_chars, completion_tokens, latency_ms, ok, error_code, error)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    runId, projectId, stageKey, provider, model, purpose,
    promptChars, promptTokens, completionChars, completionTokens, latencyMs, ok ? 1 : 0, errorCode, error)
}

export function llmUsageOfRun(runId) {
  return one(`SELECT COUNT(*) calls,
                     COALESCE(SUM(prompt_tokens),0) pt,
                     COALESCE(SUM(completion_tokens),0) ct,
                     COALESCE(SUM(latency_ms),0) ms
              FROM llm_calls WHERE run_id = ?`, runId)
}
