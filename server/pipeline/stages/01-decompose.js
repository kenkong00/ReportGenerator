import { systemBase } from '../../prompts/_common.js'
import { SCHEMAS } from '../../prompts/schemas.js'
import * as P from '../../prompts/index.js'
import * as rRepo from '../../db/repo/research.js'
import * as projRepo from '../../db/repo/projects.js'
import { GENRES, GENRE_DETECTABLE, FALLBACK_GENRE } from '../../prompts/genres.js'

/**
 * 拆解：把主问题拆成 5~15 个可检索的子问题。
 *
 * 这里是「题材」维度的落地点：
 *   - 用户指定了题材 → 只用那一套纲领拆题（快且准）
 *   - 用户选了「自动识别」 → 让模型在同一轮里先判断题材，再按对应纲领拆题
 *   - 拆完把题材固化到 ctx 与 projects 表，后续阶段全部跟着换纲领
 */
export async function run(ctx, input) {
  const topic = ctx.project.clarified_topic || ctx.project.raw_topic
  const preferred = ctx.genre  // 'auto' 或用户指定的题材

  ctx.progress(preferred === 'auto' ? '正在判断题材并拆解子问题…' : '正在拆解为可检索的子问题…')

  const messages = [
    { role: 'system', content: systemBase(ctx.tone, preferred) },
    { role: 'user', content: P.decomposePrompt(topic, ctx.mode, ctx.tone, preferred) }
  ]
  ctx.think('')
  const { data, repaired, warnings: vw } = await ctx.llm.json(messages, SCHEMAS.decompose, {
    onDelta: d => ctx.think(d),
    purpose: 'json:decompose'
  })

  // ---- 确定题材 ----
  let genre
  if (preferred && preferred !== 'auto') {
    genre = preferred                       // 用户指定优先，不接受模型改判
  } else if (GENRE_DETECTABLE.includes(data.genre)) {
    genre = data.genre                      // 自动识别结果
  } else {
    genre = FALLBACK_GENRE                  // 识别失败兜底
  }
  ctx.setGenre(genre)
  projRepo.updateProject(ctx.projectId, { genre })
  ctx.chunk('genre', { genre, label: GENRES[genre]?.label || genre })
  ctx.progress(`题材判定：${GENRES[genre]?.label || genre}`)

  let items = (data.subQuestions || []).map((s, i) => ({ ...s, ord: s.ord ?? i + 1 }))

  // 按模型能力砍规模：弱模型只保留前 N 条，避免后续阶段喂不动
  const cap = ctx.caps.subQuestions
  if (items.length > cap) {
    items = items.slice(0, cap)
  }

  // 兜底：不足时按「题材兜底模板」补默认子问题（文本来自 stage.decompose.fallback，可编辑）
  const min = ctx.weak ? 3 : 5
  if (items.length < min) {
    const { items: fb } = P.decomposeFallback(topic, genre)
    const need = Math.min(min - items.length, fb.length)
    items = items.concat(fb.slice(0, need).map((s, i) => ({ ...s, ord: items.length + i + 1 })))
  }

  const saved = rRepo.replaceSubQuestions(ctx.projectId, ctx.runId, items)
  for (const s of saved) ctx.chunk('subQuestion', s)

  ctx.progress(`拆解完成：${saved.length} 个子问题`, saved.length, saved.length)

  return {
    ok: true,
    data: {
      genre,
      genreLabel: GENRES[genre]?.label || genre,
      subQuestions: saved.map(s => ({ id: s.id, question: s.question, qtype: s.qtype, priority: s.priority }))
    },
    warnings: [
      ...(repaired ? ['模型首次输出不符合结构，已自动修复'] : []),
      ...(vw || []).slice(0, 3)
    ]
  }
}
