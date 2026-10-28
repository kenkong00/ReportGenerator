import { systemBase } from '../../prompts/_common.js'
import { SCHEMAS } from '../../prompts/schemas.js'
import * as P from '../../prompts/index.js'
import * as rRepo from '../../db/repo/research.js'
import * as da from '../../search/domainAuthority.js'
import { fetchUrl } from '../../search/fetcher.js'
import { extract as extractArticle } from '../../search/extractor.js'
import { truncate, contentHash } from '../../utils/text.js'

/**
 * 证据抽取。
 * M1：默认不抓正文（本机英文源大量不可达），用搜索摘要作为证据文本。
 * options.enableFetch = true 时才尝试抓正文；抓取失败自动退回摘要。
 */
export async function run(ctx, input) {
  const subQuestions = rRepo.listSubQuestions(ctx.projectId, ctx.runId)
  const kept = rRepo.keptSources(ctx.projectId, { runId: ctx.runId, limit: 200 })

  // 提高来源上限：来源越多、越多样，报告越少出现"未找到"（原先过小）
  const capByMode = { quick: 14, standard: 32, deep: 56 }[ctx.mode] || 32
  let targets = kept.slice(0, capByMode)
  if (targets.length < kept.length) {
    ctx.budget.degrade('source_cap', `来源过多，只处理质量最高的 ${capByMode} 条`)
  }

  if (!targets.length) {
    return { ok: false, data: { evidences: 0 }, warnings: ['没有可采信来源，跳过证据抽取'] }
  }

  // 正文抓取：前端显式指定优先；否则读设置 pipeline.enableFetch（默认开启）
  const enableFetch = ctx.options.enableFetch !== undefined
    ? !!ctx.options.enableFetch
    : (ctx.settings?.['pipeline.enableFetch'] !== false && ctx.settings?.['pipeline.enableFetch'] !== 'false')
  let fetched = 0, fetchFailed = 0, snippetOnly = 0

  ctx.progress(`从 ${targets.length} 条来源中抽取证据…`)

  const created = []
  for (let i = 0; i < targets.length; i++) {
    const src = targets[i]
    ctx.progress(`抽取证据 ${i + 1}/${targets.length}：${(src.title || src.domain).slice(0, 26)}…`, i + 1, targets.length)

    let text = src.snippet || ''
    let fetchStatus = 'skipped'

    if (enableFetch && ctx.budget.can('fetches')) {
      ctx.budget.spend('fetches', 1)
      const r = await fetchUrl(src.url, { signal: ctx.signal })
      if (r.ok) {
        const art = extractArticle(r.html, src.url)
        if (art.text && art.text.length > (src.snippet || '').length) {
          text = art.text
          fetchStatus = 'ok'
          fetched++
          rRepo.updateSourceFetch(src.id, {
            status: 'ok', fulltext: art.text.slice(0, 20000),
            contentChars: art.text.length, contentHash: contentHash(art.text)
          })
        } else {
          fetchStatus = 'failed'
          fetchFailed++
          rRepo.updateSourceFetch(src.id, { status: 'failed', error: '正文抽取为空' })
        }
      } else {
        fetchStatus = 'blocked'
        fetchFailed++
        rRepo.updateSourceFetch(src.id, { status: 'blocked', error: r.error || '抓取失败' })
      }
    }
    if (fetchStatus !== 'ok') snippetOnly++

    const sqList = subQuestions.map(s => ({ id: s.id, question: s.question }))
    const messages = [
      { role: 'system', content: systemBase(ctx.tone, ctx.genre) },
      { role: 'user', content: P.extractPrompt({ ...src, text: truncate(text, 4000) }, sqList) }
    ]

    try {
      const { data } = await ctx.llm.json(messages, SCHEMAS.evidenceExtract, { purpose: 'json:extract' })
      const items = (data.evidences || []).slice(0, 6)

      for (const it of items) {
        // 规则算置信度（权威）；LLM 只能建议降级
        let rule = { confidence: 'medium', reason: '' }
        try {
          const prof = da.profile(src.domain)
          rule = da.confidenceRule({
            tier: prof.tier, isPrimary: prof.isPrimary, independentCount: 1,
            freshnessScore: da.freshness(src.published_at, text), hasConflict: it.confidence === 'disputed'
          })
        } catch {}
        const finalConf = downgrade(it.confidence, rule.confidence)

        const id = rRepo.insertEvidence({
          projectId: ctx.projectId,
          runId: ctx.runId,
          sourceId: src.id,
          subQuestionId: it.subQuestionId || null,
          claim: it.claim,
          quote: truncate(it.quote || src.snippet || '', 800),
          dataPoints: it.dataPoints || [],
          factKey: it.factKey || null,
          polarity: it.polarity || 'neutral',
          stance: it.stance || null,
          confidence: finalConf,
          confidenceRule: rule.confidence,
          confidenceLlm: it.confidence,
          confidenceReason: rule.reason,
          inference: it.inference ? 1 : 0,
          inferenceChain: it.inferenceChain || null
        })
        created.push(id)
        ctx.chunk('evidence', {
          id, claim: it.claim, confidence: finalConf,
          domain: src.domain, tier: src.authority_tier, inference: !!it.inference
        })
      }
    } catch (e) {
      // 单条来源失败不影响整体
      ctx.logger?.warn?.(`来源 ${src.id} 抽取失败：${e.message}`)
    }
  }

  ctx.progress(`证据抽取完成：${created.length} 条`, created.length, created.length)

  return {
    ok: created.length > 0,
    data: {
      evidences: created.length,
      sources: targets.length,
      fetched, fetchFailed, snippetOnly,
      snippetOnlyRatio: targets.length ? Number((snippetOnly / targets.length).toFixed(2)) : 0
    },
    warnings: [
      ...(snippetOnly > 0 && enableFetch ? [`${snippetOnly} 条来源未能获取正文，仅使用搜索摘要作为证据文本`] : []),
      ...(!enableFetch ? ['M1 未启用正文抓取，证据文本来自搜索摘要'] : []),
      ...(created.length === 0 ? ['未能抽取到任何证据'] : [])
    ]
  }
}

/** LLM 的置信度只能往低了改，不能往高了抬 */
function downgrade(llmConf, ruleConf) {
  const order = ['disputed', 'low', 'medium', 'high']
  if (!llmConf) return ruleConf
  const li = order.indexOf(llmConf)
  const ri = order.indexOf(ruleConf)
  if (li === -1) return ruleConf
  return li < ri ? llmConf : ruleConf
}
