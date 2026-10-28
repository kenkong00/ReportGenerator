import { systemBase } from '../../prompts/_common.js'
import { SCHEMAS } from '../../prompts/schemas.js'
import * as P from '../../prompts/index.js'
import * as projRepo from '../../db/repo/projects.js'

/**
 * 澄清锁定问题。
 * M1：默认关闭（options.enableClarify = true 才启用）。
 * 启用时会生成问题并「暂停」流水线等待用户回答，由前端驱动续跑。
 */
export async function run(ctx, input) {
  const topic = ctx.project.clarified_topic || ctx.project.raw_topic

  if (!ctx.options.enableClarify) {
    // 直接把原话题当作已锁定话题
    projRepo.updateProject(ctx.projectId, { clarified_topic: topic })
    return {
      ok: true,
      skipped: true,
      data: { clarifiedTopic: topic, questions: [] },
      warnings: ['M1 未启用澄清环节，直接使用原始话题']
    }
  }

  ctx.progress('正在生成澄清问题…')
  const messages = [
    { role: 'system', content: systemBase(ctx.tone, ctx.genre) },
    { role: 'user', content: P.clarifyPrompt(topic, ctx.project.language, ctx.tone) }
  ]
  const { data } = await ctx.llm.json(messages, SCHEMAS.clarify, {
    onDelta: d => ctx.think(d),
    purpose: 'json:clarify'
  })

  projRepo.saveClarifyQuestions(ctx.projectId, data.questions || [], ctx.runId)
  for (const q of data.questions || []) {
    ctx.chunk('clarify', q)
  }

  // 有待回答的问题 → 暂停，等前端提交答案后续跑
  const pending = projRepo.pendingClarify(ctx.projectId)
  if (pending.length) {
    return {
      ok: true,
      paused: true,
      data,
      warnings: [`等待用户回答 ${pending.length} 个澄清问题`]
    }
  }

  projRepo.updateProject(ctx.projectId, { clarified_topic: data.clarifiedTopic || topic })
  return { ok: true, data, warnings: [] }
}
