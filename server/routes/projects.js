import express from 'express'
import * as projRepo from '../db/repo/projects.js'
import * as stagesRepo from '../db/repo/stages.js'
import * as bus from '../pipeline/bus.js'
import { BUDGET_PRESETS } from '../config.js'
import { v4 as uuid } from 'uuid'

const router = express.Router()

/** 列表 */
router.get('/', (req, res) => {
  try {
    const { limit = 50, offset = 0, keyword = '' } = req.query
    const rows = projRepo.listProjects({ limit: Number(limit), offset: Number(offset), keyword })
    res.json({ ok: true, items: rows.map(brief) })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

/* ---------------- versions（版本 = 一次运行 run） ---------------- */
/* 注意：这些路径要写在 '/:id' 之前，否则会被通配吃掉 */

/** 版本清单 */
router.get('/:id/versions', (req, res) => {
  try {
    const p = projRepo.getProject(req.params.id)
    if (!p) return res.status(404).json({ ok: false, error: '项目不存在' })
    res.json({ ok: true, items: projRepo.listVersions(p.id), currentRunId: p.current_run_id })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

/** 新建一个版本（同一主题重跑；可顺带换深度/题材/风格） */
router.post('/:id/versions', (req, res) => {
  try {
    const p = projRepo.getProject(req.params.id)
    if (!p) return res.status(404).json({ ok: false, error: '项目不存在' })

    const latest = projRepo.latestRun(p.id)
    if (latest && latest.status === 'running' && bus.isRunning(latest.id)) {
      return res.status(409).json({ ok: false, error: '当前版本还在运行中，请先暂停或终止' })
    }

    const { mode, genre, tone, fromStage = null } = req.body || {}
    const patch = {}
    if (mode && BUDGET_PRESETS[mode]) {
      // 只落 mode，不落 budget_json：预算交给 config 按「云端/本地模型」动态决定。
      // 之前把预设写死进项目，会让本地模型（慢得多）永远卡在 12 分钟的墙钟上。
      patch.mode = mode
    }
    if (genre) patch.genre = genre
    if (tone) {
      let opts = {}
      try { opts = JSON.parse(p.options_json || '{}') } catch {}
      patch.options_json = JSON.stringify({ ...opts, tone })
    }
    if (Object.keys(patch).length) projRepo.updateProject(p.id, patch)

    const run = projRepo.createRun(p.id, { trigger: 'version', fromStage })
    bus.startRun(run.id, fromStage)
    res.json({ ok: true, runId: run.id, seq: run.seq })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

/** 删除某个版本 */
router.delete('/:id/versions/:runId', (req, res) => {
  try {
    const r = projRepo.deleteRun(req.params.id, req.params.runId)
    if (!r.ok) return res.status(404).json({ ok: false, error: r.error })
    res.json({ ok: true, remaining: r.remaining })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

/** 把某个版本设为当前版本 */
router.post('/:id/versions/:runId/activate', (req, res) => {
  try {
    const p = projRepo.activateRun(req.params.id, req.params.runId)
    if (!p) return res.status(404).json({ ok: false, error: '版本不存在' })
    res.json({ ok: true, project: p })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

/** 详情（含最新 run 与阶段） */
router.get('/:id', (req, res) => {
  try {
    const p = projRepo.getProject(req.params.id)
    if (!p) return res.status(404).json({ ok: false, error: '项目不存在' })
    const run = projRepo.latestRun(p.id)
    const stages = run ? stagesRepo.listStages(run.id) : []
    res.json({
      ok: true,
      project: p,
      run,
      stages,
      clarify: projRepo.listClarify(p.id)
    })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

/** 创建 */
router.post('/', (req, res) => {
  try {
    const { rawTopic, title, mode = 'standard', genre = 'auto', options = {} } = req.body || {}
    if (!rawTopic || !String(rawTopic).trim()) {
      return res.status(400).json({ ok: false, error: '请输入研究话题' })
    }
    const budget = BUDGET_PRESETS[mode] || BUDGET_PRESETS.standard
    const p = projRepo.createProject({
      title: title || String(rawTopic).slice(0, 60),
      rawTopic: String(rawTopic).trim(),
      mode,
      genre,
      budget,
      options
    })
    res.json({ ok: true, project: p })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

/** 更新（如提交澄清答案） */
router.patch('/:id', (req, res) => {
  try {
    const allowed = ['title', 'clarified_topic', 'mode', 'genre']
    const patch = {}
    for (const k of allowed) if (k in (req.body || {})) patch[k] = req.body[k]
    const p = projRepo.updateProject(req.params.id, patch)
    res.json({ ok: true, project: p })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

/** 提交澄清答案 */
router.post('/:id/clarify', (req, res) => {
  try {
    const { answers = [] } = req.body || {}
    for (const a of answers) {
      projRepo.answerClarify(a.id, a.answer || '', !a.answer)
    }
    res.json({ ok: true, pending: projRepo.pendingClarify(req.params.id).length })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

/** 删除 */
router.delete('/:id', (req, res) => {
  try {
    projRepo.softDeleteProject(req.params.id)
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

/* ---------------- runs ---------------- */

/** 启动一次调研 */
router.post('/:id/run', (req, res) => {
  try {
    const p = projRepo.getProject(req.params.id)
    if (!p) return res.status(404).json({ ok: false, error: '项目不存在' })

    const running = projRepo.latestRun(p.id)
    if (running && running.status === 'running' && bus.isRunning(running.id)) {
      return res.status(409).json({ ok: false, error: '该项目的调研正在运行中', runId: running.id })
    }

    const { fromStage = null, resume = false } = req.body || {}

    // 续跑：上一次是暂停 / 失败 / 中断时，复用同一个 run（已完成的阶段不重跑）
    if (resume && running && ['paused', 'failed', 'aborted'].includes(running.status)) {
      bus.resumeRun(running.id, fromStage)
      return res.json({ ok: true, runId: running.id, seq: running.seq, resumed: true })
    }

    const run = projRepo.createRun(p.id, { trigger: fromStage ? 'resume' : 'manual', fromStage })
    bus.startRun(run.id, fromStage)
    res.json({ ok: true, runId: run.id, seq: run.seq })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

/** 中止 */
router.post('/:id/abort', (req, res) => {
  try {
    const run = projRepo.latestRun(req.params.id)
    if (!run) return res.status(404).json({ ok: false, error: '没有运行中的任务' })
    bus.abortRun(run.id)
    projRepo.updateRun(run.id, { status: 'aborted', finished_at: new Date().toISOString() })
    projRepo.updateProject(req.params.id, { status: 'aborted' })
    res.json({ ok: true, status: 'aborted' })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

/** 阶段列表 + 事件（过程回看） */
router.get('/:id/runs', (req, res) => {
  try {
    const runs = projRepo.listRuns(req.params.id)
    const out = runs.map(r => ({ ...r, stages: stagesRepo.listStages(r.id) }))
    res.json({ ok: true, items: out })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

function brief(p) {
  return {
    id: p.id, title: p.title, raw_topic: p.raw_topic, mode: p.mode, genre: p.genre || 'auto',
    status: p.status, version_count: p.version_count || 1,
    created_at: p.created_at, updated_at: p.updated_at
  }
}

export default router
