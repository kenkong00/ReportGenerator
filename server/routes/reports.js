import express from 'express'
import * as secRepo from '../db/repo/reports.js'
import * as rRepo from '../db/repo/research.js'
import * as projRepo from '../db/repo/projects.js'
import { toMarkdown } from '../export/markdown.js'
import { toHtml } from '../export/html.js'
import { toWordHtml } from '../export/word.js'

const router = express.Router()

/** 报告 + 证据 + 来源 + 分歧（报告页一次拿全）；?runId= 指定版本，缺省用当前版本 */
router.get('/project/:id', (req, res) => {
  try {
    const p = projRepo.getProject(req.params.id)
    if (!p) return res.status(404).json({ ok: false, error: '项目不存在' })

    const versions = projRepo.listVersions(p.id)
    const runId = req.query.runId || p.current_run_id || projRepo.latestRun(p.id)?.id || null
    const run = runId ? projRepo.getRun(runId) : null
    if (!run) {
      return res.json({ ok: true, project: p, run: null, versions, reports: [], evidences: [], sources: [], disagreements: [], sections: [], availableVariants: [] })
    }

    const variant = req.query.variant || 'standard'
    const report = secRepo.getReport(p.id, run.id, variant) || secRepo.getReport(p.id, run.id, 'standard')
    const reports = secRepo.listReports(p.id, run.id)
    const evidences = rRepo.listEvidences(p.id, run.id)
    const sources = rRepo.listSourcesForRun(p.id, run.id)
    const disagreements = rRepo.listDisagreements(p.id, run.id)
    const sections = secRepo.listSections(p.id, run.id)

    res.json({
      ok: true,
      project: p,
      run,
      versions,
      report,
      availableVariants: reports.map(r => r.variant),
      evidences,
      sources,
      disagreements: disagreements.map(d => ({ ...d, positions: tryParse(d.positions_json) })),
      sections: sections.map(s => ({
        ...s,
        key_points: tryParse(s.key_points_json),
        evidence_ids: tryParse(s.evidence_ids_json),
        unresolved: tryParse(s.unresolved_json),
        audit: tryParse(s.audit_json)
      }))
    })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

/** 切换档位（可指定版本） */
router.get('/project/:id/:variant', (req, res) => {
  try {
    const p = projRepo.getProject(req.params.id)
    if (!p) return res.status(404).json({ ok: false, error: '项目不存在' })
    const runId = req.query.runId || p.current_run_id || projRepo.latestRun(p.id)?.id
    const rep = runId ? secRepo.getReport(p.id, runId, req.params.variant) : null
    if (!rep) return res.status(404).json({ ok: false, error: '该档位报告不存在' })
    res.json({ ok: true, report: rep })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

/** 导出（可指定版本） */
router.get('/project/:id/export/:format', (req, res) => {
  try {
    const p = projRepo.getProject(req.params.id)
    if (!p) return res.status(404).json({ ok: false, error: '项目不存在' })
    const runId = req.query.runId || p.current_run_id || projRepo.latestRun(p.id)?.id
    const variant = req.query.variant || 'standard'
    const rep = runId ? secRepo.getReport(p.id, runId, variant) : null
    if (!rep) return res.status(404).json({ ok: false, error: '报告不存在' })

    const fmt = req.params.format
    const base = (p.title || 'report').replace(/[\\/:*?"<>|]/g, '_').slice(0, 40)
    const evidences = rRepo.listEvidences(p.id, runId)

    if (fmt === 'md') {
      const md = toMarkdown(rep, p, evidences)
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8')
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(base)}.md`)
      return res.send(md)
    }
    if (fmt === 'html') {
      const html = toHtml(rep, p, evidences, rRepo.listSourcesForRun(p.id, runId))
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(base)}.html`)
      return res.send(html)
    }
    if (fmt === 'doc') {
      const html = toWordHtml(rep, p, evidences)
      res.setHeader('Content-Type', 'application/msword; charset=utf-8')
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(base)}.doc`)
      return res.send(html)
    }
    res.status(400).json({ ok: false, error: '不支持的格式' })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

function tryParse(v) {
  try { return JSON.parse(v) } catch { return [] }
}

export default router
