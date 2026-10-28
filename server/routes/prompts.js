/**
 * 提示词管理 API。
 * 所有提示词都存 DB、可公开增删改；改完立即生效（运行时每次都从 DB 取）。
 */
import express from 'express'
import * as promptsRepo from '../db/repo/prompts.js'
import { render } from '../prompts/render.js'
import { systemBase } from '../prompts/_common.js'
import { TONES } from '../prompts/tones.js'

const router = express.Router()

const CATEGORY_META = {
  system: { label: '系统底座', desc: '所有调用的总规则', order: 0 },
  policy: { label: '内容政策', desc: '成人/敏感话题尺度（管理员可调）', order: 1 },
  tone: { label: '报告风格', desc: '严肃 / 轻松 / 搞怪的措辞与报告骨架', order: 2 },
  genre: { label: '题材纲领', desc: '按题材切换整套拆题/视角/取信标准', order: 3 },
  stage: { label: '流水线各步骤', desc: 'AI 一步步的运作提示词', order: 4 },
  schema: { label: '输出结构说明', desc: '每步要求的 JSON 结构（谨慎改）', order: 5 },
  custom: { label: '自定义', desc: '用户自建', order: 6 }
}

router.get('/', (req, res) => {
  try {
    const category = req.query.category || null
    const items = promptsRepo.list(category)
    res.json({
      ok: true,
      items,
      categories: CATEGORY_META,
      tones: Object.values(TONES),
      count: items.length
    })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

/** 导出全部（备份） */
router.get('/export', (req, res) => {
  try {
    res.json({ ok: true, items: promptsRepo.exportAll() })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

/** 导入（只覆盖已存在的 key 的 template/enabled） */
router.post('/import', (req, res) => {
  try {
    const n = promptsRepo.importAll(req.body?.items || [])
    res.json({ ok: true, imported: n })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

/** 全部恢复出厂默认 */
router.post('/reset-all', (req, res) => {
  try {
    promptsRepo.resetAll()
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

/** 预览：把某模板用给定变量渲染出来（前端"渲染预览"用） */
router.post('/preview', (req, res) => {
  try {
    const { template = '', variables = {} } = req.body || {}
    res.json({ ok: true, rendered: render(template, variables) })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

/** 预览"系统底座"最终拼装结果（含内容政策 + 题材语境 + 指定风格） */
router.get('/preview-system', (req, res) => {
  try {
    const tone = req.query.tone || 'professional'
    const genre = req.query.genre || 'auto'
    res.json({ ok: true, rendered: systemBase(tone, genre) })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

/** 新建自定义提示词 */
router.post('/', (req, res) => {
  try {
    const { key, name, category, description, template } = req.body || {}
    const item = promptsRepo.createCustom({ key, name, category, description, template })
    res.json({ ok: true, item })
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message })
  }
})

/** 读取单个 */
router.get('/:key', (req, res) => {
  try {
    const item = promptsRepo.get(decodeURIComponent(req.params.key))
    if (!item) return res.status(404).json({ ok: false, error: '提示词不存在' })
    res.json({ ok: true, item })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

/** 保存 */
router.put('/:key', (req, res) => {
  try {
    const ok = promptsRepo.update(decodeURIComponent(req.params.key), req.body || {})
    if (!ok) return res.status(404).json({ ok: false, error: '提示词不存在' })
    res.json({ ok: true, item: promptsRepo.get(decodeURIComponent(req.params.key)) })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

/** 恢复默认 */
router.post('/:key/reset', (req, res) => {
  try {
    const ok = promptsRepo.reset(decodeURIComponent(req.params.key))
    if (!ok) return res.status(404).json({ ok: false, error: '提示词不存在' })
    res.json({ ok: true, item: promptsRepo.get(decodeURIComponent(req.params.key)) })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

/** 删除（仅自建） */
router.delete('/:key', (req, res) => {
  try {
    const ok = promptsRepo.remove(decodeURIComponent(req.params.key))
    if (!ok) return res.status(404).json({ ok: false, error: '提示词不存在' })
    res.json({ ok: true })
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message })
  }
})

export default router
