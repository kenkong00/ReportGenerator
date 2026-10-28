import { systemBase } from '../../prompts/_common.js'
import { SCHEMAS } from '../../prompts/schemas.js'
import * as P from '../../prompts/index.js'
import * as rRepo from '../../db/repo/research.js'
import * as secRepo from '../../db/repo/reports.js'
import { j, wordCount } from '../../utils/text.js'

/** 装配层固定的章节标签，随 tone 变化（与 tone.<key>.shape 里约定的命名保持一致） */
function labels(tone) {
  if (tone === 'playful') {
    return {
      execSummary: '一句话钩子',
      coreConclusion: '核心结论',
      disagreementMap: '吵得最凶的点',
      limitations: '我自己也没搞明白的地方',
      biggestDisagreement: '吵得最凶的点',
      weakestPart: '最不靠谱的部分'
    }
  }
  if (tone === 'casual') {
    return {
      execSummary: '先说结论',
      coreConclusion: '核心结论',
      disagreementMap: '大家各执一词的点',
      limitations: '我也有没搞明白的地方',
      biggestDisagreement: '最大的分歧',
      weakestPart: '最不靠谱的部分'
    }
  }
  return {
    execSummary: '执行摘要',
    coreConclusion: '核心结论',
    disagreementMap: '分歧地图',
    limitations: '本报告的局限',
    biggestDisagreement: '最大分歧',
    weakestPart: '最不可靠的部分'
  }
}

/**
 * 三档装配：自底向上，不是"先写长再压缩"。
 *   速览 = 各节 keyPoints + 执行摘要（写作时已产出，禁止二次生成）
 *   标准 = 各节 md 拼接
 *   深度 = 标准 + 每节独立扩写（只喂本节证据，绝不喂全文）
 */
export async function run(ctx, input) {
  const topic = ctx.project.clarified_topic || ctx.project.raw_topic
  const sections = secRepo.listSections(ctx.projectId, ctx.runId)
  const disagreements = rRepo.listDisagreements(ctx.projectId, ctx.runId)
  const evidences = rRepo.listEvidences(ctx.projectId, ctx.runId)

  if (!sections.length) return { ok: false, data: {}, warnings: ['没有章节可装配'] }

  const offlineNotice = ctx.search.statusNote()
  const degraded = ctx.budget.degradations

  // ---- 执行摘要 ----
  ctx.progress('正在生成执行摘要…')
  let summary = null
  try {
    const messages = [
      { role: 'system', content: systemBase(ctx.tone, ctx.genre) },
      { role: 'user', content: P.summaryPrompt(topic, sections.map(s => ({ heading: s.heading, key_points: j(s.key_points_json, []) })), disagreements, ctx.tone) }
    ]
    const { data } = await ctx.llm.json(messages, SCHEMAS.executiveSummary, { purpose: 'json:summary' })
    summary = data
  } catch (e) {
    // 摘要失败不能让报告失败，但必须在报告里显式声明（降级要可见，这是本项目的硬规矩）
    ctx.budget.degrade('summary_llm_failed', `执行摘要由模型生成失败（${String(e.message || e).slice(0, 60)}），已改用各节要点直接拼接`)
    const kps = sections.flatMap(s => j(s.key_points_json, []))
    summary = {
      summary: kps.slice(0, 5).join(' ') || '各节要点尚未生成，请直接看正文。',
      biggestDisagreement: disagreements.length ? disagreements[0].topic : '本次未发现显著分歧',
      weakestPart: '执行摘要不是模型跨节归纳出来的，而是把各节要点按顺序拼起来的，所以读起来会有点跳。',
      limitations: offlineNotice || '见本文末局限说明'
    }
  }

  // ---- 速览版 ----
  const briefMd = buildBrief(topic, summary, sections, disagreements, offlineNotice, degraded, ctx.tone)
  secRepo.upsertReport({
    projectId: ctx.projectId, runId: ctx.runId, variant: 'brief',
    title: topic, subtitle: '速览版 · 一屏看懂', md: briefMd,
    offlineNotice,
    stats: { sections: sections.length, mode: ctx.mode },
    quality: {}
  })

  // ---- 标准版 ----
  const standardMd = buildStandard(topic, summary, sections, disagreements, offlineNotice, degraded, ctx.tone)
  secRepo.upsertReport({
    projectId: ctx.projectId, runId: ctx.runId, variant: 'standard',
    title: topic, subtitle: '标准版 · 完整论证', md: standardMd,
    offlineNotice,
    stats: {
      sections: sections.length,
      evidences: evidences.length,
      disagreements: disagreements.length,
      mode: ctx.mode
    },
    quality: {}
  })

  // ---- 深度版（仅 deep 模式逐节扩写；弱模型模式直接跳过，省下大量调用）----
  let deepMd = null
  if (ctx.mode === 'deep' && ctx.weak) {
    ctx.budget.degrade('skip_deep_weak_model', '当前为轻量模式（模型能力有限），不生成深度版')
  } else if (ctx.mode === 'deep' && ctx.budget.can('tokens', 20000)) {
    ctx.progress('正在逐节扩写深度版…')
    const expanded = []
    for (let i = 0; i < sections.length; i++) {
      const s = sections[i]
      ctx.progress(`扩写 ${i + 1}/${sections.length}：${s.heading}`, i + 1, sections.length)
      const secEvs = evidences.filter(e => j(s.evidence_ids_json, []).includes(e.id))
      try {
        const messages = [
          { role: 'system', content: systemBase(ctx.tone, ctx.genre) },
          {
            role: 'user',
            content: P.expandPrompt(
              { heading: s.heading, md: s.md, key_points: j(s.key_points_json, []) },
              { topic, evidences: secEvs, tone: ctx.tone }
            )
          }
        ]
        const { data } = await ctx.llm.json(messages, SCHEMAS.sectionExpand, { purpose: `json:expand:${s.heading.slice(0, 12)}` })
        expanded.push({ id: s.id, mdDeep: data.md || s.md })
      } catch {
        expanded.push({ id: s.id, mdDeep: s.md })
      }
    }
    for (const e of expanded) secRepo.updateSection(e.id, { md_deep: e.mdDeep })

    const refreshed = secRepo.listSections(ctx.projectId, ctx.runId)
    deepMd = buildDeep(topic, summary, refreshed, disagreements, offlineNotice, degraded, ctx.tone)
  } else if (ctx.mode === 'deep') {
    ctx.budget.degrade('skip_deep_expand', 'token 预算不足，深度版不扩写，等同标准版')
    deepMd = standardMd
  }

  if (deepMd) {
    secRepo.upsertReport({
      projectId: ctx.projectId, runId: ctx.runId, variant: 'deep',
      title: topic, subtitle: '深度版 · 完整论证与数据细节', md: deepMd,
      offlineNotice,
      stats: { sections: sections.length, mode: ctx.mode },
      quality: {}
    })
  }

  const words = { brief: wordCount(briefMd), standard: wordCount(standardMd), deep: deepMd ? wordCount(deepMd) : 0 }
  ctx.progress(`装配完成：速览 ${words.brief} 字 / 标准 ${words.standard} 字${deepMd ? ` / 深度 ${words.deep} 字` : ''}`)

  return {
    ok: true,
    data: { words, variants: deepMd ? ['brief', 'standard', 'deep'] : ['brief', 'standard'] },
    warnings: degraded.map(d => `降级：${d.action}`)
  }
}

/* ---------------- 装配函数 ---------------- */

function offlineBlock(notice) {
  return notice
    ? `> ⚠️ **${notice}**\n\n`
    : ''
}

function degradeBlock(degraded) {
  if (!degraded?.length) return ''
  const label = {
    skip_low_priority: '跳过了部分低优先级子问题',
    fetch_budget_hit: '部分来源未能抓取正文，证据文本来自搜索摘要',
    search_budget_hit: '检索次数达到上限，停止了后续查询',
    token_budget_hit: '生成预算接近上限',
    source_cap: '只处理了质量最高的一部分来源',
    offline: '联网检索未成功',
    skip_deep_expand: '深度版未做逐节扩写',
    skip_deep_weak_model: '轻量模式：未生成深度版',
    cap_subquestions: '按当前模型档位缩减了子问题数量',
    wallclock_hit: '总耗时达到上限，后续非关键步骤已跳过（报告已正常生成）',
    summary_llm_failed: '执行摘要未由模型生成，改用各节要点拼接'
  }
  return `\n---\n\n### 本轮执行的降级说明\n\n` +
    degraded.map(d => `- ${label[d.action] || d.action}（${d.reason}）`).join('\n') + '\n'
}

function buildBrief(topic, summary, sections, disagreements, notice, degraded, tone = 'professional') {
  const L = labels(tone)
  const kps = sections.flatMap(s => (j(s.key_points_json, []) || []).map(k => `- ${k}`))
  return `# ${topic}

${offlineBlock(notice)}## ${L.execSummary}

${summary?.summary || ''}

**${L.biggestDisagreement}**：${summary?.biggestDisagreement || '无'}

**${L.weakestPart}**：${summary?.weakestPart || '未评估'}

**${L.limitations}**：${summary?.limitations || '见文末'}

---

## ${L.coreConclusion}

${kps.length ? kps.join('\n') : '（未生成）'}

---

## ${L.disagreementMap}

${disagreements.length
    ? disagreements.map(d => `**${d.topic}**\n\n${(j(d.positions_json, []) || []).map(p => `- ${p.stance}：${p.claim}`).join('\n')}\n\n根因：${d.root_cause || '未判定'}｜状态：${adjudLabel(d.adjudication)}${d.verdict ? `｜${d.verdict}` : ''}`).join('\n\n')
    : '本次调研未发现显著分歧。'}

${degradeBlock(degraded)}`
}

function adjudLabel(a) {
  return { adjudicated: '✅ 已裁决', unresolved: '⚠️ 未裁决', partially: '🔶 部分裁决' }[a] || a
}

function buildStandard(topic, summary, sections, disagreements, notice, degraded, tone = 'professional') {
  const L = labels(tone)
  const body = sections.map(s => {
    const kp = j(s.key_points_json, []) || []
    const un = j(s.unresolved_json, []) || []
    let out = `## ${s.heading}\n\n${s.md}\n`
    if (kp.length) out += `\n**本节要点**\n\n${kp.map(k => `- ${k}`).join('\n')}\n`
    if (un.length) out += `\n> 本节未解决：${un.join('；')}\n`
    return out
  }).join('\n\n---\n\n')

  const dis = disagreements.length
    ? `## ${L.disagreementMap}\n\n${disagreements.map((d, i) =>
        `### ${i + 1}. ${d.topic}\n\n` +
        `${(j(d.positions_json, []) || []).map(p => `- **${p.stance}**：${p.claim}${p.why ? `（${p.why}）` : ''}`).join('\n')}\n\n` +
        `- **为什么会不一样**：${d.root_cause || '未判定'}\n` +
        `- **裁决状态**：${adjudLabel(d.adjudication)}\n` +
        (d.verdict ? `- **本报告口径**：${d.verdict}\n` : '')
      ).join('\n\n')}`
    : `## ${L.disagreementMap}\n\n本次调研未发现显著分歧。这不代表没有分歧，也可能意味着检索范围还不够宽。`

  return `# ${topic}

${offlineBlock(notice)}## ${L.execSummary}

${summary?.summary || ''}

- **${L.biggestDisagreement}**：${summary?.biggestDisagreement || '无'}
- **${L.weakestPart}**：${summary?.weakestPart || '未评估'}
- **${L.limitations}**：${summary?.limitations || '见文末'}

---

${body}

---

${dis}

---

## ${L.limitations}

1. ${summary?.limitations || '证据强度有限'}
2. 证据文本${degraded?.some(d => d.action === 'fetch_budget_hit') ? '多来自搜索摘要而非正文全文，细节可能不完整' : '来自检索到的来源'}
3. 未裁决的分歧共 ${disagreements.filter(d => d.adjudication === 'unresolved').length} 处，已在${L.disagreementMap}中列出
${degradeBlock(degraded)}`
}

function buildDeep(topic, summary, sections, disagreements, notice, degraded, tone = 'professional') {
  const L = labels(tone)
  const body = sections.map(s => {
    const md = s.md_deep || s.md
    const kp = j(s.key_points_json, []) || []
    const un = j(s.unresolved_json, []) || []
    let out = `## ${s.heading}\n\n${md}\n`
    if (kp.length) out += `\n**本节要点**\n\n${kp.map(k => `- ${k}`).join('\n')}\n`
    if (un.length) out += `\n> 本节未解决：${un.join('；')}\n`
    return out
  }).join('\n\n---\n\n')

  return `# ${topic}（深度版）

${offlineBlock(notice)}## ${L.execSummary}

${summary?.summary || ''}

- **${L.biggestDisagreement}**：${summary?.biggestDisagreement || '无'}
- **${L.weakestPart}**：${summary?.weakestPart || '未评估'}

---

${body}

---

## ${L.disagreementMap}

${disagreements.map((d, i) =>
  `### ${i + 1}. ${d.topic}\n\n` +
  `${(j(d.positions_json, []) || []).map(p => `- **${p.stance}**：${p.claim}`).join('\n')}\n\n` +
  `- **为什么会不一样**：${d.root_cause || '未判定'}\n- **裁决状态**：${adjudLabel(d.adjudication)}\n` +
  (d.verdict ? `- **本报告口径**：${d.verdict}\n` : '')
).join('\n\n') || `本次调研未发现显著分歧。这不代表没有分歧，也可能意味着检索范围还不够宽。`}
${degradeBlock(degraded)}`
}
