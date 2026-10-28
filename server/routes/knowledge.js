import express from 'express'
import * as kb from '../db/repo/knowledge.js'
import * as rRepo from '../db/repo/research.js'
import * as secRepo from '../db/repo/reports.js'
import { v4 as uuid } from 'uuid'

const router = express.Router()

router.get('/', (req, res) => {
  try {
    res.json({
      ok: true,
      items: kb.listDocuments({ keyword: req.query.keyword || '' }),
      stats: kb.stats()
    })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

/** 粘贴文本 / 导入网页 */
router.post('/', async (req, res) => {
  try {
    const { title, text, url, authorityTier = 'C', tags = [] } = req.body || {}
    if (!text && !url) return res.status(400).json({ ok: false, error: '需要提供文本或网址' })

    let content = text || ''
    let finalTitle = title
    let originUrl = url || null

    if (url && !text) {
      const { fetchUrl } = await import('../search/fetcher.js')
      const { extract } = await import('../search/extractor.js')
      const r = await fetchUrl(url)
      if (!r.ok) return res.status(502).json({ ok: false, error: `抓取失败：${r.error}` })
      const art = extract(r.html, url)
      content = art.text
      finalTitle = title || art.title || url
      if (art.publishedAt) originUrl = url
    }

    if (!content || content.length < 20) {
      return res.status(400).json({ ok: false, error: '内容过短或抓取为空' })
    }

    const doc = kb.createDocument({
      title: finalTitle || content.slice(0, 40),
      sourceType: url ? 'url' : 'paste',
      originUrl,
      authorityTier,
      tags,
      charCount: content.length
    })

    const chunks = chunkText(content, 900)
    kb.addChunks(doc.id, chunks)

    res.json({ ok: true, doc: kb.getDocument(doc.id), chunks: chunks.length })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

/** 全文检索（调试用） */
router.get('/search', (req, res) => {
  try {
    const q = req.query.q || ''
    res.json({ ok: true, items: kb.search(q, 20) })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

/** 把报告沉淀进知识库 */
router.post('/sink/:projectId', async (req, res) => {
  try {
    const p = req.params.projectId
    const run = (await import('../db/repo/projects.js')).latestRun(p)
    const doc = kb.sinkReport(p, run.id, req.body?.title || '未命名报告')
    res.json({ ok: true, doc })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

router.delete('/:id', (req, res) => {
  try {
    kb.deleteDocument(req.params.id)
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

/** 按段落边界切分，避免把句子切断 */
function chunkText(text, size = 900) {
  const clean = String(text || '').replace(/\r/g, '')
  const paras = clean.split(/\n{1,}/).filter(t => t.trim())
  const out = []
  let buf = ''
  for (const p of paras) {
    if ((buf + p).length > size && buf) {
      out.push({ heading: null, text: buf.trim() })
      buf = ''
    }
    buf += (buf ? '\n' : '') + p
    while (buf.length > size * 1.5) {
      out.push({ heading: null, text: buf.slice(0, size).trim() })
      buf = buf.slice(size)
    }
  }
  if (buf.trim()) out.push({ heading: null, text: buf.trim() })
  return out
}

export default router
