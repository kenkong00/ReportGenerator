import { systemBase } from '../../prompts/_common.js'
import { SCHEMAS } from '../../prompts/schemas.js'
import * as P from '../../prompts/index.js'
import * as rRepo from '../../db/repo/research.js'
import * as secRepo from '../../db/repo/reports.js'
import { j, uncoveredClaimRatio } from '../../utils/text.js'

/**
 * 逐节自审（不做全量——全量上下文必爆）。
 * M1：只记录 issues，不自动改写正文。
 */
export async function run(ctx, input) {
  const sections = secRepo.listSections(ctx.projectId, ctx.runId)
  if (!sections.length) return { ok: false, data: {}, warnings: ['没有章节可审'] }

  const capByMode = { quick: 3, standard: 99, deep: 99 }[ctx.mode] ?? 99
  const targets = sections.slice(0, capByMode)

  ctx.progress(`正在自审 ${targets.length} 个章节…`)

  const issues = []
  let uncoveredTotal = 0

  for (let i = 0; i < targets.length; i++) {
    const s = targets[i]
    ctx.progress(`自审 ${i + 1}/${targets.length}：${s.heading}`, i + 1, targets.length)

    // 规则先算一遍：未挂证据的句子比例
    const ratio = uncoveredClaimRatio(s.md)
    uncoveredTotal += ratio

    const ids = j(s.evidence_ids_json, []) || []
    const evs = ids.length ? rRepo.evidencesByIds(ctx.projectId, ids) : []

    try {
      const messages = [
        { role: 'system', content: systemBase(ctx.tone, ctx.genre) },
        { role: 'user', content: P.auditPrompt({ heading: s.heading, md: s.md }, evs) }
      ]
      const { data } = await ctx.llm.json(messages, SCHEMAS.audit, { purpose: `json:audit:${s.heading.slice(0, 12)}` })
      const list = data.issues || []
      if (list.length) {
        secRepo.updateSection(s.id, { audit_json: list, status: 'audited' })
        for (const it of list) issues.push({ section: s.heading, ...it })
        ctx.chunk('auditIssue', { heading: s.heading, count: list.length, types: [...new Set(list.map(x => x.type))] })
      } else {
        secRepo.updateSection(s.id, { audit_json: [], status: 'audited' })
      }
    } catch (e) {
      // 自审失败不影响报告
    }
  }

  const avgUncovered = targets.length ? Number((uncoveredTotal / targets.length).toFixed(3)) : 0
  const quality = {
    issues: issues.slice(0, 50),
    issueCount: issues.length,
    byType: countBy(issues, 'type'),
    uncoveredClaimRatio: avgUncovered
  }

  // 回填到三档报告的 quality_json
  for (const variant of ['brief', 'standard', 'deep']) {
    const rep = secRepo.getReport(ctx.projectId, ctx.runId, variant)
    if (rep) secRepo.upsertReport({
      projectId: ctx.projectId, runId: ctx.runId, variant,
      title: rep.title, subtitle: rep.subtitle, md: rep.md,
      offlineNotice: rep.offline_notice,
      stats: j(rep.stats_json, {}),
      quality
    })
  }

  ctx.progress(`自审完成：发现 ${issues.length} 处问题，未挂证据句比例约 ${(avgUncovered * 100).toFixed(0)}%`)

  return {
    ok: true,
    data: { issues: issues.length, byType: quality.byType, uncoveredClaimRatio: avgUncovered },
    warnings: issues.length ? [`自审发现 ${issues.length} 处问题，可在报告页查看`] : []
  }
}

function countBy(arr, key) {
  const m = {}
  for (const it of arr) m[it[key]] = (m[it[key]] || 0) + 1
  return m
}
