/**
 * 各步骤提示词的组装层。
 *
 * 注意：这里【不再写死任何提示词文本】。每个函数只负责两件事：
 *   1) 把动态数据（题目、证据列表、子问题列表…）预渲染成字符串块；
 *   2) 调用 renderPrompt('stage.xxx.user', {...}) 把块填进 DB 里的模板。
 * 想改提示词 → 到「提示词管理」页面改，或直接改数据库，改完即生效（无需重启）。
 *
 * 想改某个模板的措辞，请改 prompt_templates 表里的 stage.* / system.base / tone.* / policy.content。
 */
import { schemaBlock } from './schemas.js'
import { effectiveTemplate, renderPrompt } from './render.js'
import { toneNote } from './tones.js'
import { genrePlan, resolveGenre } from './_common.js'
import { GENRES, GENRE_DETECTABLE, GENRE_PLANS } from './genres.js'

/** 取某题材的作战纲领（DB 优先，回退出厂默认） */
function planOf(key) {
  return effectiveTemplate(`genre.${key}.plan`) || GENRE_PLANS[key] || ''
}

/* ---------------- 澄清 ---------------- */
export function clarifyPrompt(topic, lang = 'zh', tone = 'professional') {
  return renderPrompt('stage.clarify.user', {
    topic,
    toneNote: toneNote(tone),
    schemaBlock: schemaBlock('clarify')
  })
}

/* ---------------- 拆解 ---------------- */
/**
 * 拆解提示词。
 * genre === 'auto' 时，要求模型自己先判断题材（此时会把 5 套纲领全部列出，避免再花一次 LLM 调用）；
 * 用户指定了题材时，只给那一套纲领（更快更准）。
 */
export function decomposePrompt(clarifiedTopic, mode = 'standard', tone = 'professional', genre = 'auto') {
  const count = mode === 'quick' ? '5~8' : mode === 'deep' ? '10~15' : '7~11'
  const isAuto = !genre || genre === 'auto'

  let genreInstruction
  let genrePlanBlock

  if (isAuto) {
    genreInstruction = `【第一步：先判断题材】
请先判断这个话题属于下面哪一类题材，把结果填进 genre 字段（只能填 life / ent / society / biz / tech 之一）：
${GENRE_DETECTABLE.map(k => `- ${k} ${GENRES[k].label}：${GENRES[k].desc}`).join('\n')}

判断完之后，**只使用被选中那一类的纲领**来拆题（下面把五套纲领都列出来了，请自行取用对应的一套，不要混用）。`
    genrePlanBlock = GENRE_DETECTABLE.map(k => planOf(k)).join('\n\n')
  } else {
    const g = resolveGenre(genre)
    genreInstruction = `【题材已指定】这个话题按「${GENRES[g].label}」题材处理，请把 genre 字段填成 \`${g}\`，并严格按下面的纲领拆题。`
    genrePlanBlock = planOf(g)
  }

  return renderPrompt('stage.decompose.user', {
    topic: clarifiedTopic,
    count,
    genreInstruction,
    genrePlanBlock,
    toneNote: toneNote(tone),
    schemaBlock: schemaBlock('decompose')
  })
}

/** 兜底子问题（模型给少了时补足）—— 从模板解析，避免写死在代码里 */
export function decomposeFallback(topic, genre = 'life') {
  const g = resolveGenre(genre)
  const tpl = effectiveTemplate('stage.decompose.fallback') || ''
  const items = []
  for (const raw of String(tpl).split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const [q, qtype, expectedSourceType, priority] = line.split('|').map(s => (s || '').trim())
    if (!q || !qtype) continue
    items.push({
      question: q.replace(/\{topic\}/g, topic),
      qtype,
      expectedSourceType: expectedSourceType || 'media',
      priority: Number(priority) || 2,
      rationale: '兜底：保证每个方向都有东西可查'
    })
  }
  return { items, genreLabel: GENRES[g]?.label || '通用' }
}

/* ---------------- 视角 ---------------- */
export function perspectivePrompt(topic, subQuestions, tone = 'professional', genre = 'auto') {
  const subQuestionBlock = subQuestions.map((s, i) => `${i + 1}. ${s.question}`).join('\n')
  return renderPrompt('stage.perspective.user', {
    topic,
    subQuestionBlock,
    genrePlanBlock: genrePlan(genre),
    toneNote: toneNote(tone),
    schemaBlock: schemaBlock('perspectives')
  })
}

/** 依据话题 + 题材给出"来源要多样"的站点定向建议（国内平台） */
function buildSiteHints(topic, question, genre = 'auto') {
  const text = `${topic || ''} ${question || ''}`
  const g = String(genre || '')
  const picks = ['zhihu.com']
  if (g === 'ent' || /娱乐|明星|八卦|综艺|电影|电视剧|音乐|游戏|动漫|追星|网红|偶像|女优|演员|歌手/.test(text)) {
    picks.push('weibo.com', 'bilibili.com', 'douban.com')
  }
  if (g === 'life' || /穿搭|护肤|美妆|种草|消费|购物|买|礼物|女生|男生|好物|美食|旅游|健身/.test(text)) {
    picks.push('xiaohongshu.com')
  }
  if (g === 'tech' || /科技|互联网|创业|公司|融资|产品|数码|手机|芯片|AI|软件/.test(text)) picks.push('36kr.com', 'ithome.com')
  if (g === 'society' || /新闻|时事|政策|社会|事件|舆论/.test(text)) picks.push('toutiao.com', 'thepaper.cn')
  if (/职场|工资|就业|考研|大学|教育/.test(text)) picks.push('zhihu.com', 'xiaohongshu.com')
  const uniq = [...new Set(picks)]
  // 注意：不要用 "/" 连接多个 site，否则模型会把整串当成一条查询（踩过）。
  const lines = uniq.map((d, i) => `   ${i + 1}) 关键词 site:${d}`).join('\n')
  return `- 【系统建议的来源定向】如需做平台定向，请**另起一条查询**、且该条只带一个 site:（不要合并）：\n${lines}\n  国内平台常能提供国外搜不到的本地视角；但不要每条查询都挂 site:，多数查询保持自然关键词即可。`
}

/* ---------------- 查询词 ---------------- */
export function queryPrompt(subQuestion, topic, lang = 'zh', genre = 'auto') {
  return renderPrompt('stage.query.user', {
    topic,
    question: subQuestion.question,
    qtype: subQuestion.qtype,
    expectedSourceType: subQuestion.expectedSourceType,
    siteHints: buildSiteHints(topic, subQuestion.question, genre),
    schemaBlock: schemaBlock('queryGen')
  })
}

/* ---------------- 来源评估 ---------------- */
export function sourceEvalPrompt(candidates, topic, genre = 'auto') {
  const sourceBlock = candidates.map((c, i) =>
    `[${i}] 标题：${c.title}\n    URL：${c.url}\n    域名：${c.domain}\n    摘要：${(c.snippet || '').slice(0, 300)}`
  ).join('\n\n')

  return renderPrompt('stage.sourceEval.user', {
    topic,
    count: candidates.length,
    sourceBlock,
    genrePlanBlock: genrePlan(genre),
    schemaBlock: schemaBlock('sourceEval')
  })
}

/* ---------------- 证据抽取 ---------------- */
export function extractPrompt(source, subQuestions) {
  const subQuestionBlock = subQuestions.map(s => `- [id:${s.id}] ${s.question}`).join('\n')
  return renderPrompt('stage.extract.user', {
    title: source.title,
    url: source.url,
    domain: source.domain,
    tier: source.authority_tier || 'U',
    text: source.text || source.snippet || '（无正文，仅摘要）',
    subQuestionBlock,
    schemaBlock: schemaBlock('evidenceExtract')
  })
}

/* ---------------- 交叉验证 ---------------- */
export function crosscheckPrompt(groups, topic) {
  const groupBlock = groups.map(g => `
### 子问题 [id:${g.subQuestionId}]：${g.question}
证据（按 factKey 分组）：
${g.items.map(e => `  - [ev:${e.id}]（${e.stance || '?'}，${e.confidence}）${e.claim}${e.dataPoints?.length ? ' 【数据：' + e.dataPoints.map(d => `${d.label}=${d.value}${d.unit || ''}@${d.asOf || '?'}`).join('; ') + '】' : ''}`).join('\n')}
`).join('\n')

  return renderPrompt('stage.crosscheck.user', {
    topic,
    groupBlock,
    schemaBlock: schemaBlock('crosscheck')
  })
}

/* ---------------- 大纲 ---------------- */
export function outlinePrompt(topic, perspectives, answeredSQs, mode = 'standard', tone = 'professional') {
  const perspectiveList = perspectives.map(p => `- ${p.key}（${p.name}）：${p.lens}`).join('\n')
  const sqList = answeredSQs.map(s => `- [id:${s.id}] ${s.question}${s.answer ? ' → 已答：' + s.answer.slice(0, 80) : ' → 未答'}`).join('\n')
  const sectionCount = mode === 'quick' ? '4~6 节' : mode === 'deep' ? '9~14 节' : '6~9 节'
  const shapeBlock = effectiveTemplate(`tone.${tone || 'professional'}.shape`) || ''

  return renderPrompt('stage.outline.user', {
    topic,
    perspectiveList,
    sqList,
    sectionCount,
    shapeBlock,
    toneNote: toneNote(tone),
    schemaBlock: schemaBlock('outline')
  })
}

/* ---------------- 逐节写作 ---------------- */
export function sectionPrompt(section, ctx) {
  const { topic, subQuestions, evidences, priorSummaries = [], mode = 'standard', tone = 'professional' } = ctx

  const subQuestionBlock = subQuestions.length
    ? subQuestions.map(s => `- [id:${s.id}] ${s.question}${s.answer ? `\n    已有答案：${s.answer}` : ''}`).join('\n')
    : '（本节无指定子问题）'

  const evidenceBlock = evidences.length
    ? evidences.map(e =>
`[ev:${e.id}] 断言：${e.claim}
     来源：${e.source_title || ''}（${e.domain || ''}，权威 ${e.authority_tier || 'U'}，置信度 ${e.confidence}${e.inference ? '，【这是推断】' : ''}）
     原文摘录：${(e.quote || '').slice(0, 500)}
     ${e.data_points?.length ? '数据点：' + e.data_points.map(d => `${d.label}=${d.value}${d.unit || ''}@${d.asOf || '?'}`).join('; ') : ''}
     ${e.inference_chain ? '推理链条：' + e.inference_chain : ''}`
    ).join('\n\n')
    : '（本节暂无检索到的证据）'

  const priorBlock = priorSummaries.length
    ? `\n【前文已写过的内容（避免重复，一句话摘要）】\n${priorSummaries.map((s, i) => `${i + 1}. ${s}`).join('\n')}`
    : ''

  const words = mode === 'quick' ? '150~300 字' : mode === 'deep' ? '800~1500 字' : '400~800 字'

  return renderPrompt('stage.section.user', {
    topic,
    heading: section.heading,
    purpose: section.purpose || '',
    perspectiveLine: section.perspective_key ? `【本节视角】${section.perspective_key}` : '',
    subQuestionBlock,
    evidenceCount: evidences.length,
    evidenceBlock,
    priorBlock,
    words,
    toneNote: toneNote(tone),
    schemaBlock: schemaBlock('sectionWrite')
  })
}

/* ---------------- 深度版扩写 ---------------- */
export function expandPrompt(section, ctx) {
  const { topic, evidences, tone = 'professional' } = ctx
  const keyPointBlock = (section.key_points || []).map((k, i) => `${i + 1}. ${k}`).join('\n')

  const evidenceBlock = evidences.map(e =>
`[ev:${e.id}] ${e.claim}
     来源：${e.source_title || ''}（${e.domain || ''}，${e.authority_tier || 'U'}）
     摘录：${(e.quote || '').slice(0, 600)}
     ${e.inference_chain ? '推理链条：' + e.inference_chain : ''}`
  ).join('\n\n')

  return renderPrompt('stage.expand.user', {
    topic,
    heading: section.heading,
    keyPointBlock,
    standardMd: section.md,
    evidenceBlock,
    toneNote: toneNote(tone),
    schemaBlock: schemaBlock('sectionExpand')
  })
}

/* ---------------- 执行摘要 ---------------- */
export function summaryPrompt(topic, sections, disagreements, tone = 'professional') {
  const keyPointList = sections.flatMap((s, i) => (s.key_points || []).map(k => `（第${i + 1}节 ${s.heading}）${k}`)).join('\n')
  const disagreementBlock = disagreements.map(d => `- ${d.topic}：${(d.positions || []).map(p => `${p.stance}方认为「${p.claim}」`).join('；')}｜${d.adjudication === 'adjudicated' ? '已裁决：' + (d.verdict || '') : '未裁决'}`).join('\n')

  return renderPrompt('stage.summary.user', {
    topic,
    keyPointList,
    disagreementBlock: disagreementBlock || '（无）',
    toneNote: toneNote(tone),
    schemaBlock: schemaBlock('executiveSummary')
  })
}

/* ---------------- 分歧地图润色 ---------------- */
export function disagreementPrompt(topic, disagreements, tone = 'professional') {
  const disagreementBlock = disagreements.map((d, i) => `[${i}] ${d.topic}\n    各方：${(d.positions || []).map(p => `${p.stance}→${p.claim}`).join(' | ')}\n    根因：${d.root_cause}\n    裁决：${d.adjudication} ${d.verdict || ''}`).join('\n\n')

  return renderPrompt('stage.disagreement.user', {
    topic,
    disagreementBlock,
    toneNote: toneNote(tone),
    schemaBlock: schemaBlock('crosscheck')
  })
}

/* ---------------- 逐节自审 ---------------- */
export function auditPrompt(section, evidences) {
  const allow = evidences.map(e => e.id)
  const evidenceBlock = evidences.map(e => `[ev:${e.id}] ${e.claim}（${e.confidence}${e.inference ? '，推断' : ''}）`).join('\n')

  return renderPrompt('stage.audit.user', {
    heading: section.heading,
    sectionMd: section.md,
    allowIds: allow.join(', '),
    evidenceBlock,
    schemaBlock: schemaBlock('audit')
  })
}
