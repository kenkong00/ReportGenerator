import { systemBase } from '../../prompts/_common.js'
import { SCHEMAS } from '../../prompts/schemas.js'
import * as P from '../../prompts/index.js'
import * as rRepo from '../../db/repo/research.js'

/**
 * 视角定义：4~6 个分析视角。
 *
 * 注意：视角方向由**题材纲领**决定（见 genre.<key>.plan），
 * 这里不再强制注入 skeptic，也不再用「技术/资本/产业链/政策」这套企业视角兜底——
 * 那正是过去"问娱乐人物却产出产业分析"的元凶之一。
 * 兜底视角只保证"够 4 个"，且与题材无关（事实/数字/口碑/脉络）。
 */
const FALLBACK = [
  { key: 'facts', name: '具体事实与清单', lens: '先把客观事实、涉及的具体对象和名单摆清楚', keyMetrics: ['具体对象', '数量', '时间点'] },
  { key: 'numbers', name: '数字与排名', lens: '能查到的规模、热度、榜单名次等硬指标', keyMetrics: ['具体数字', '榜单名次', '热度'] },
  { key: 'reception', name: '口碑与评价', lens: '各方（支持者 / 路人 / 专业方）分别怎么说', keyMetrics: ['正面评价', '负面评价', '争议点'] },
  { key: 'timeline', name: '来龙去脉', lens: '这件事或这个对象是怎么一步步变成今天这样的', keyMetrics: ['关键节点', '变化', '转折'] }
]

export async function run(ctx, input) {
  const topic = ctx.project.clarified_topic || ctx.project.raw_topic
  const subQuestions = rRepo.listSubQuestions(ctx.projectId, ctx.runId)

  ctx.progress('正在定义分析视角…')
  const messages = [
    { role: 'system', content: systemBase(ctx.tone, ctx.genre) },
    { role: 'user', content: P.perspectivePrompt(topic, subQuestions.map(s => ({ question: s.question })), ctx.tone, ctx.genre) }
  ]
  const { data, repaired } = await ctx.llm.json(messages, SCHEMAS.perspectives, {
    onDelta: d => ctx.think(d),
    purpose: 'json:perspectives'
  })

  const items = data.perspectives || []

  // 保证至少 4 个（题材无关的通用兜底）
  let fi = 0
  while (items.length < 4 && fi < FALLBACK.length) {
    if (!items.some(p => p.key === FALLBACK[fi].key)) items.push(FALLBACK[fi])
    fi++
  }

  const saved = rRepo.replacePerspectives(ctx.projectId, ctx.runId, items)
  for (const p of saved) ctx.chunk('perspective', p)

  ctx.progress(`视角定义完成：${saved.length} 个`, saved.length, saved.length)

  return {
    ok: true,
    data: { perspectives: saved.map(p => ({ key: p.key, name: p.name, lens: p.lens })) },
    warnings: repaired ? ['模型首次输出不符合结构，已自动修复'] : []
  }
}
