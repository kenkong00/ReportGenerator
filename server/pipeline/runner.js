import { STAGES, EVENT, stageInfo } from './types.js'
import { impl, FATAL_STAGES, DELIVERABLE_STAGES } from './registry.js'
import * as stagesRepo from '../db/repo/stages.js'
import * as runRepo from '../db/repo/projects.js'
import * as secRepo from '../db/repo/reports.js'
import { isPause } from '../utils/errors.js'

/**
 * 流水线状态机：顺序执行、幂等 upsert、失败分类、断点续跑。
 * @param {RunContext} ctx
 * @param {{fromStage?:string, onlyStage?:string, skip?:string[]}} opts
 */
export async function runPipeline(ctx, opts = {}) {
  const done = new Set(stagesRepo.succeededStageKeys(ctx.runId))
  const fromIdx = opts.fromStage ? STAGES.findIndex(s => s.key === opts.fromStage) : -1
  const skip = new Set(opts.skip || [])

  ctx.emit(EVENT.RUN_START, {
    runId: ctx.runId, projectId: ctx.projectId, mode: ctx.mode,
    budget: ctx.budget.summary(),
    stages: STAGES.map(s => ({ key: s.key, index: s.index, title: s.title })),
    resumedFrom: opts.fromStage || null
  })

  let fatal = null
  let paused = false
  let pausedStage = null
  // 预算（墙钟）触顶后进入「只交付」模式：跳过一切非交付阶段，但 render / audit 必须跑完。
  // 否则会出现「阶段都跑完了、报告一个字都没有」的情况（历史 bug）。
  let deliverOnly = false

  for (const st of STAGES) {
    if (ctx.aborted) break
    // 暂停闸门（阶段边界）：已完成的阶段都落库了，下次继续时会自动跳过
    if (ctx.pauseRequested) { paused = true; pausedStage = st.key; break }
    if (skip.has(st.key)) continue
    if (opts.onlyStage && st.key !== opts.onlyStage) continue
    if (fromIdx >= 0 && st.index < fromIdx) continue
    // 只交付模式：交付阶段照跑，其余一律不跑
    if (deliverOnly && !DELIVERABLE_STAGES.has(st.key)) continue

    // 断点续跑：已成功且不是本次指定重跑的阶段 → 跳过
    if (done.has(st.key) && st.key !== opts.onlyStage && fromIdx < 0) {
      ctx.emit(EVENT.STAGE_SKIP, { stageKey: st.key, reason: 'already_succeeded' })
      continue
    }

    stagesRepo.upsertStage({
      runId: ctx.runId, projectId: ctx.projectId,
      stageKey: st.key, stageIndex: st.index, title: st.title, status: 'pending'
    })
    stagesRepo.startStage(ctx.runId, st.key)
    ctx.enterStage(st.key)
    runRepo.updateRun(ctx.runId, { current_stage: st.key })

    ctx.emit(EVENT.STAGE_START, { stageKey: st.key, index: st.index, title: st.title, attempt: 1 })

    const t0 = Date.now()
    try {
      const fn = impl(st.key)
      const input = ctx.options.inputOverride?.[st.key] ?? null
      stagesRepo.setStageInput(ctx.runId, st.key, { note: '输入由各阶段自行从 DB 读取', override: input })

      const out = await fn(ctx, input)

      if (out?.paused) {
        stagesRepo.finishStage(ctx.runId, st.key, {
          status: 'succeeded', output: out,
          summary: `暂停：${(out.warnings || []).join('；') || '等待用户输入'}`
        })
        ctx.emit(EVENT.STAGE_DONE, { stageKey: st.key, summary: '暂停，等待用户回答', paused: true })
        runRepo.updateRun(ctx.runId, { status: 'paused' })
        paused = true
        break
      }

      const ok = out?.ok !== false
      stagesRepo.finishStage(ctx.runId, st.key, {
        status: ok ? 'succeeded' : 'succeeded_with_warnings',
        output: out,
        summary: summarize(st.key, out)
      })
      ctx.emit(EVENT.STAGE_DONE, {
        stageKey: st.key,
        summary: summarize(st.key, out),
        warnings: out?.warnings || [],
        durationMs: Date.now() - t0,
        output: out?.data || null
      })
      ctx.warnBudget()

      // 预算触顶：不失败，而是降级收尾 —— 但「报告交付物」阶段（render / audit）
      // 无论如何都必须跑，否则弱模型（本地小模型跑得慢）会永远出不了报告。
      // 注意：这里不能 break，break 会把 render / audit 一起跳过。
      if (ctx.budget.hit('wallclock')) {
        ctx.budget.degrade('wallclock_hit', '总耗时达到上限，已尽力完成；报告仍会正常生成')
        ctx.hitBudget('wallclock', ['wallclock_hit'])
        if (!DELIVERABLE_STAGES.has(st.key)) deliverOnly = true
      }
    } catch (e) {
      // 暂停：当前阶段标 paused（下次从它重跑），整轮标 paused
      if (isPause(e)) {
        stagesRepo.finishStage(ctx.runId, st.key, {
          status: 'paused',
          output: null,
          summary: '已暂停（本阶段未跑完，继续时重跑）'
        })
        ctx.emit(EVENT.RUN_PAUSED, {
          stageKey: st.key, index: st.index, title: st.title,
          resumeHint: '已完成阶段的成果均已保存，点「继续」从此处接着跑'
        })
        runRepo.updateRun(ctx.runId, { status: 'paused', current_stage: st.key })
        runRepo.updateProject(ctx.projectId, { status: 'paused' })
        paused = true
        break
      }
      const msg = String(e.message || e)
      stagesRepo.finishStage(ctx.runId, st.key, {
        status: 'failed', error: msg, summary: `失败：${msg.slice(0, 120)}`
      })
      ctx.emit(EVENT.STAGE_ERROR, {
        stageKey: st.key,
        error: { code: e.code || 'unknown', message: msg.slice(0, 300) },
        retryable: !FATAL_STAGES.has(st.key),
        fatal: FATAL_STAGES.has(st.key)
      })
      if (FATAL_STAGES.has(st.key)) { fatal = e; break }
    }
  }

  const reports = secRepo.listReports(ctx.projectId, ctx.runId)
  const stats = {
    ...ctx.budget.summary(),
    reports: reports.map(r => ({ variant: r.variant, words: r.word_count }))
  }

  if (fatal) {
    runRepo.finishRun(ctx.runId, 'failed', { ...stats, error: String(fatal.message) })
    runRepo.updateProject(ctx.projectId, { status: 'failed' })
    ctx.emit(EVENT.RUN_FAILED, {
      stageKey: ctx.stageKey,
      error: { code: fatal.code || 'unknown', message: String(fatal.message).slice(0, 300) }
    })
    return { ok: false, error: fatal.message }
  }

  // 被用户/看门狗中止：复用同一 run，状态标 aborted（已完成的阶段成果保留，可点「继续」续跑）
  if (ctx.aborted) {
    const cur = runRepo.getRun(ctx.runId)
    if (cur && cur.status !== 'aborted') {
      runRepo.finishRun(ctx.runId, 'aborted', stats)
      runRepo.updateProject(ctx.projectId, { status: 'aborted' })
    }
    ctx.emit(EVENT.RUN_ABORTED, {
      stageKey: ctx.stageKey,
      resumeHint: '已收集的内容都在，点「继续」可从断点接着跑'
    })
    return { ok: true, aborted: true }
  }

  // 阶段边界处的暂停：补全状态与事件
  if (paused) {
    const cur = runRepo.getRun(ctx.runId)
    if (cur && cur.status === 'running') {
      runRepo.updateRun(ctx.runId, { status: 'paused', current_stage: pausedStage || ctx.stageKey })
      runRepo.updateProject(ctx.projectId, { status: 'paused' })
      ctx.emit(EVENT.RUN_PAUSED, {
        stageKey: pausedStage || ctx.stageKey,
        resumeHint: '已完成阶段的成果均已保存，点「继续」从此处接着跑'
      })
    }
    return { ok: true, paused: true }
  }

  // 交付物兜底：一次「成功」的运行必须至少产出一份报告。
  // 若因为中途跳出 / 阶段缺失导致一份报告都没有，绝不能报 succeeded ——
  // 否则前端会显示「已完成」却看不到任何内容（历史 bug：只有一句“这个版本还没有产出报告”）。
  if (!reports.length) {
    const hasSections = secRepo.listSections(ctx.projectId, ctx.runId).length > 0
    const msg = hasSections
      ? '流水线跑完了但没有产出报告（装配阶段未执行）。已写好的章节与证据都还在，点「补跑装配」即可直接成稿，无需重新检索。'
      : '流水线跑完了但没有产出报告：这一轮没有生成任何章节，前面某个阶段应该是失败了。点「继续」可从头重跑。'
    runRepo.finishRun(ctx.runId, 'budget_exceeded', { ...stats, error: msg })
    runRepo.updateProject(ctx.projectId, { status: 'failed' })
    ctx.emit(EVENT.RUN_FAILED, {
      stageKey: ctx.stageKey,
      error: { code: 'no_report', message: msg },
      retryable: true,
      resumeHint: hasSections ? '点「补跑装配」从 render 阶段续跑' : '点「继续」重跑'
    })
    return { ok: false, error: msg }
  }

  runRepo.finishRun(ctx.runId, 'succeeded', stats)
  runRepo.updateProject(ctx.projectId, { status: 'succeeded' })
  ctx.emit(EVENT.RUN_DONE, {
    reportVariants: reports.map(r => r.variant),
    durationMs: ctx.budget.elapsedMs,
    stats
  })
  return { ok: true, stats }
}

function summarize(key, out) {
  if (!out) return '无输出'
  const d = out.data || {}
  const map = {
    clarify: () => `锁定话题：${d.clarifiedTopic || '（沿用原话题）'}`,
    decompose: () => `拆解为 ${d.subQuestions?.length || 0} 个子问题`,
    perspectives: () => `定义 ${d.perspectives?.length || 0} 个分析视角`,
    search: () => `检索 ${d.queries || 0} 条查询，新增 ${d.newSources || 0} 条来源（去重 ${d.dupSources || 0}）`,
    source_eval: () => `评估 ${d.total || 0} 条来源，保留 ${d.kept || 0} 条（A:${d.byTier?.A || 0} B:${d.byTier?.B || 0} C:${d.byTier?.C || 0}）`,
    extract: () => `抽取 ${d.evidences || 0} 条证据（其中 ${d.snippetOnly || 0} 条来自摘要）`,
    crosscheck: () => `识别 ${d.disagreements || 0} 处分歧，裁决 ${d.adjudicated || 0} 处`,
    draft: () => `完成 ${d.sections || 0} 节写作`,
    render: () => `装配完成：速览 ${d.words?.brief || 0} 字 / 标准 ${d.words?.standard || 0} 字${d.words?.deep ? ` / 深度 ${d.words?.deep} 字` : ''}`,
    audit: () => `自审发现 ${d.issues || 0} 处问题`
  }
  try { return map[key]?.() || '完成' } catch { return '完成' }
}
