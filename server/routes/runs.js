import express from 'express'
import * as stagesRepo from '../db/repo/stages.js'
import * as projRepo from '../db/repo/projects.js'
import * as bus from '../pipeline/bus.js'

const router = express.Router()

/**
 * SSE 事件流。
 * GET /api/runs/:runId/events?lastSeq=N
 * 帧的 id: = stage_events.seq，断线后浏览器自动带 Last-Event-ID 续拉。
 */
router.get('/:runId/events', (req, res) => {
  const runId = req.params.runId
  const lastSeq = Number(req.query.lastSeq || req.headers['last-event-id'] || 0)
  const run = projRepo.getRun(runId)
  if (!run) {
    res.status(404).json({ ok: false, error: 'run 不存在' })
    return
  }
  bus.subscribe(runId, res, lastSeq)
})

/** 历史事件（分页，过程回看用） */
router.get('/:runId/events/all', (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit || 500), 2000)
    const since = Number(req.query.since || 0)
    const rows = stagesRepo.eventsSince(req.params.runId, since, limit)
    res.json({
      ok: true,
      items: rows.map(r => ({
        seq: r.seq, stageKey: r.stage_key, type: r.type,
        payload: safeParse(r.payload_json), createdAt: r.created_at
      }))
    })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

/** 阶段详情（含 input/output JSON —— 透明性核心） */
router.get('/:runId/stages', (req, res) => {
  try {
    const rows = stagesRepo.listStages(req.params.runId)
    res.json({
      ok: true,
      items: rows.map(r => ({
        ...r,
        input_json: safeParse(r.input_json),
        output_json: safeParse(r.output_json)
      }))
    })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

router.get('/:runId/stages/:key', (req, res) => {
  try {
    const s = stagesRepo.getStage(req.params.runId, req.params.key)
    if (!s) return res.status(404).json({ ok: false, error: '阶段不存在' })
    res.json({
      ok: true,
      stage: { ...s, input_json: safeParse(s.input_json), output_json: safeParse(s.output_json) }
    })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

function ensureRun(req, res) {
  const run = projRepo.getRun(req.params.runId)
  if (!run) {
    res.status(404).json({ ok: false, error: 'run 不存在' })
    return null
  }
  return run
}

/** 暂停：当前这步跑完就停，已完成阶段的成果保留 */
router.post('/:runId/pause', (req, res) => {
  if (!ensureRun(req, res)) return
  try {
    bus.pauseRun(req.params.runId)
    res.json({ ok: true, status: 'paused' })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

/** 继续：复用同一个 run，从第一个未成功的阶段接跑 */
router.post('/:runId/resume', (req, res) => {
  const run = ensureRun(req, res)
  if (!run) return
  try {
    if (bus.isRunning(run.id)) return res.json({ ok: true, status: 'running', note: '已在运行中' })
    const { fromStage = null } = req.body || {}
    bus.resumeRun(run.id, fromStage)
    res.json({ ok: true, status: 'running', fromStage: fromStage || 'auto' })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

/** 重跑某个阶段（也可传 fromStage 表示从该阶段往后全部重跑） */
router.post('/:runId/rerun', (req, res) => {
  const run = ensureRun(req, res)
  if (!run) return
  try {
    if (bus.isRunning(run.id)) {
      return res.status(409).json({ ok: false, error: '该任务正在运行中，请先暂停' })
    }
    const { stage = null } = req.body || {}
    const ok = bus.rerunStage(run.id, stage)
    res.json({ ok, status: 'running', stage })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

/** 终止：不再续跑（区别于暂停，产物保留但状态为 aborted） */
router.post('/:runId/abort', (req, res) => {
  if (!ensureRun(req, res)) return
  try {
    bus.abortRun(req.params.runId)
    const run = projRepo.getRun(req.params.runId)
    projRepo.updateProject(run.project_id, { status: 'aborted' })
    res.json({ ok: true, status: 'aborted' })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

/** 续跑点：第一个未成功完成的阶段（前端用它提示"将从这里继续"） */
router.get('/:runId/resume-point', (req, res) => {
  const run = ensureRun(req, res)
  if (!run) return
  const stages = stagesRepo.listStages(run.id)
  const bad = stages.find(s => s.status !== 'succeeded')
  res.json({
    ok: true,
    runId: run.id,
    status: run.status,
    alive: bus.isRunning(run.id),
    resumeFrom: bad?.stage_key || null,
    done: stages.filter(s => s.status === 'succeeded').map(s => s.stage_key)
  })
})

router.get('/:runId', (req, res) => {
  try {
    const run = projRepo.getRun(req.params.runId)
    if (!run) return res.status(404).json({ ok: false, error: 'run 不存在' })
    res.json({
      ok: true,
      run,
      stats: safeParse(run.stats_json),
      stages: stagesRepo.listStages(run.id),
      llmUsage: stagesRepo.llmUsageOfRun(run.id)
    })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

function safeParse(v) {
  try { return JSON.parse(v) } catch { return v }
}

export default router
