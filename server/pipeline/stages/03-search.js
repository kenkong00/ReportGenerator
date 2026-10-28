import { systemBase } from '../../prompts/_common.js'
import { SCHEMAS } from '../../prompts/schemas.js'
import * as P from '../../prompts/index.js'
import * as rRepo from '../../db/repo/research.js'
import { urlHash, domainOf } from '../../utils/text.js'
import { buildAnchors } from '../../search/relevance.js'

/**
 * 检索：为每个子问题生成查询词 → 并发检索 → 来源去重入库。
 * 预算耗尽时按优先级砍掉低优先级子问题。
 */
export async function run(ctx, input) {
  const subQuestions = rRepo.listSubQuestions(ctx.projectId, ctx.runId)
  if (!subQuestions.length) return { ok: false, data: {}, warnings: ['没有子问题，跳过检索'] }

  // 预算不足时砍掉 priority=3
  // 按模型/预算能力砍规模：弱模型少搜几个子问题、每个少生成几个查询词
  let targets = subQuestions
  const capSq = ctx.caps.subQuestions
  if (targets.length > capSq) {
    ctx.budget.degrade('cap_subquestions', `当前模型档位只处理前 ${capSq} 个子问题`)
    targets = targets.slice(0, capSq)
  }
  if (ctx.budget.maxSearches < targets.length * 2) {
    targets = subQuestions.filter(s => (s.priority || 2) <= 2)
    if (targets.length) {
      ctx.budget.degrade('skip_low_priority', '检索预算不足，跳过优先级 3 的子问题')
      ctx.hitBudget('searches', ['skip_low_priority'])
    }
  }

  ctx.progress(`为 ${targets.length} 个子问题生成检索词…`)

  // ---- 1. 生成查询词 ----
  const allQueries = []
  for (let i = 0; i < targets.length; i++) {
    const sq = targets[i]
    if (ctx.budget && !ctx.budget.can('searches', 2)) {
      ctx.progress('检索预算接近上限，停止生成新查询', i, targets.length)
      break
    }
    ctx.progress(`生成检索词 ${i + 1}/${targets.length}：${sq.question.slice(0, 24)}…`, i + 1, targets.length)

    let qs = []
    try {
      const messages = [
        { role: 'system', content: systemBase(ctx.tone, ctx.genre) },
        { role: 'user', content: P.queryPrompt(sq, ctx.project.clarified_topic || ctx.project.raw_topic, 'zh', ctx.genre) }
      ]
      const { data } = await ctx.llm.json(messages, SCHEMAS.queryGen, { purpose: 'json:queryGen' })
      qs = normalizeQueries(data?.queries, ctx.caps.queriesPerSq)
    } catch (e) {
      qs = []
    }

    // 规则兜底：LLM 失败时直接用子问题本身做查询
    if (qs.length < 2) {
      qs = [
        { query: sq.question.slice(0, 40), lang: 'zh' },
        { query: `${sq.question.slice(0, 30)} ${extractEn(ctx.project.raw_topic)}`.trim(), lang: 'en' }
      ]
    }

    for (const q of qs) {
      const id = rRepo.insertQuery({
        projectId: ctx.projectId, runId: ctx.runId, subQuestionId: sq.id,
        query: q.query, lang: q.lang || 'zh', engine: 'auto'
      })
      allQueries.push({ id, subQuestionId: sq.id, query: q.query, lang: q.lang || 'zh', sq })
      ctx.chunk('query', { id, query: q.query, lang: q.lang || 'zh', subQuestionId: sq.id })
    }
  }

  // ---- 2. 并发检索 ----
  ctx.progress(`开始检索，共 ${allQueries.length} 条查询…`)
  let done = 0
  let totalResults = 0

  // 话题锚点：用于相关性闸门，剔除与话题无关的填充结果。
  // 注意只用「话题本身」——不要把子问题也塞进来（子问题含"市场/数据/健康/旅游"这类
  // 通用词，会把"国家4A级旅游景区""Millennials in the US"之类无关条目放进来）。
  const topicText = ctx.project.clarified_topic || ctx.project.raw_topic || ''
  const anchors = buildAnchors(topicText)

  const results = await ctx.search.searchMany(allQueries, {
    limit: 8,
    signal: ctx.signal,
    anchors,
    onEach: (r, d, total) => {
      done = d
      ctx.progress(`检索 ${d}/${total}：${r.query.query.slice(0, 24)}…（${r.results.length} 条）`, d, total)
      ctx.warnBudget()
    }
  })

  // ---- 3. 来源去重入库 ----
  let newSources = 0
  let dupSources = 0
  for (const r of results) {
    rRepo.updateQuery(r.query.id, {
      status: r.ok ? (r.results.length ? 'ok' : 'empty') : 'error',
      engine_used: r.engine, results_count: r.results.length, error: r.error || null
    })
    for (const item of r.results) {
      if (!item?.url) continue
      const hash = urlHash(item.url)
      const ins = rRepo.upsertSource({
        projectId: ctx.projectId,
        url: item.url,
        urlHash: hash,
        title: item.title || '',
        snippet: item.snippet || '',
        domain: domainOf(item.url) || item.domain || '',
        publishedAt: item.publishedAt || null,
        fromEngine: item.engine || r.engine,
        fromQueryId: r.query.id,
        runId: ctx.runId
      })
      if (ins.dup) dupSources++
      else {
        newSources++
        totalResults++
        ctx.chunk('source', { id: ins.id, title: item.title, domain: domainOf(item.url), url: item.url, engine: item.engine })
      }
    }
  }

  // 是否"完全没检索到东西"：以实际入库来源为准（含重复计数），
  // 而不是 search hub 的单查询标志位——避免 1 条空查询把整轮误判为离线。
  const offline = newSources === 0 && dupSources === 0
  if (offline) {
    ctx.budget.degrade('offline', '联网检索未返回结果')
  }

  return {
    ok: newSources > 0 || !offline,
    data: {
      queries: allQueries.length,
      newSources,
      dupSources,
      filtered: ctx.search.filteredOut || 0,
      engines: [...ctx.search.enginesUsed],
      offline
    },
    warnings: [
      ...(offline ? ['联网检索未返回任何结果，报告将标注为"未联网"'] : []),
      ...(ctx.search.filteredOut ? [`相关性过滤剔除 ${ctx.search.filteredOut} 条与话题无关的结果`] : []),
      ...(dupSources ? [`去重 ${dupSources} 条重复来源`] : [])
    ]
  }
}

/**
 * 规范化 LLM 产出的查询词：
 * - 把误拼在一起的多条查询拆开（分号；斜杠/竖线/顿号/换行/ OR 连接）
 * - 去掉包裹的引号、首尾空白
 * - 去掉空串、重复项
 * - 重新推断 zh/en
 * 这一步是"报告检索不到东西"的关键修复：模型常把中英双语或两条 site: 查询
 * 拼成一条，丢进搜索引擎只会得到无关的填充结果。
 */
export function normalizeQueries(items, max = 4) {
  let arr = items
  if (typeof arr === 'string') arr = [arr]
  if (!Array.isArray(arr)) return []
  const out = []
  const seen = new Set()
  for (const it of arr) {
    let raw = typeof it === 'string' ? it : (it?.query ?? '')
    raw = String(raw || '')
    // 先剥掉包裹引号
    raw = raw.replace(/^[\s"'`「『]+|[\s"'`」』]+$/g, '')
    // 按分隔符切成原子查询
    const parts = raw
      .split(/\s+OR\s+|\s*[；;、|｜／]\s*|\s+\/\s+|\n|\r/)
      .map(s => s.replace(/^[\s"'`「『]+|[\s"'`」』]+$/g, '').trim())
      .filter(Boolean)
    for (const p of parts) {
      let q = p.replace(/\s+/g, ' ').trim()
      if (q.length < 2 || q.length > 80) continue
      // 只有 site: 没有关键词的查询没有意义（会返回该站任意页面），丢掉
      if (/^site:[^\s]+$/i.test(q)) continue
      // 一条查询里出现两个 site: 说明模型没拆干净——只保留第一个 site 及其前的关键词
      const sites = q.match(/site:[^\s]+/gi) || []
      if (sites.length > 1) q = q.split(/\s+OR\s+/i)[0].trim()
      const key = q.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ query: q, lang: /[\u4e00-\u9fa5]/.test(q) ? 'zh' : 'en' })
      if (out.length >= max) return out
    }
  }
  return out
}

/** 从话题里抠一点英文关键词，用于生成英文查询（很粗糙，兜底用） */
function extractEn(topic) {
  const m = String(topic || '').match(/[A-Za-z][A-Za-z\s]{2,20}/g)
  if (m) return m[0].trim()
  const known = {
    '比亚迪': 'BYD', '特斯拉': 'Tesla', '马斯克': 'Elon Musk', '华为': 'Huawei',
    '宁德时代': 'CATL', '小米': 'Xiaomi', '苹果': 'Apple', '英伟达': 'NVIDIA',
    'GDP': 'GDP', '经济': 'economy', '新能源': 'new energy vehicle'
  }
  for (const [k, v] of Object.entries(known)) {
    if (String(topic || '').includes(k)) return v
  }
  return ''
}
