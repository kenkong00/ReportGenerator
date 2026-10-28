/**
 * 系统底座 + 题材运行期辅助。
 *
 * systemBase(tone, genre) 是所有 LLM 调用的 messages[0]：
 *   - 底座正文来自数据库模板 system.base（可在「提示词管理」里改）
 *   - {{contentPolicy}}   ← policy.content  模板（成人/敏感话题尺度）
 *   - {{genreGuidance}}   ← genre.<k>.voice 模板（本题材的语境与取信标准）
 *   - {{toneStyle}}       ← tone.<k>        模板（报告风格措辞）
 *
 * genrePlan(genre) 供「拆解 / 视角 / 来源评估」三步注入题材作战纲领。
 */
import { effectiveTemplate, render } from './render.js'
import { toneStyle } from './tones.js'
import { GENRE_DETECTABLE, FALLBACK_GENRE, GENERIC_VOICE } from './genres.js'

/** 把任意值规范成有效题材键（auto/空 → 兜底题材） */
export function resolveGenre(genre) {
  const g = String(genre || '').trim()
  if (GENRE_DETECTABLE.includes(g)) return g
  return FALLBACK_GENRE
}

/** 题材作战纲领（拆题原则 / 分析视角 / 信得过的来源 / 写作要诀） */
export function genrePlan(genre) {
  const g = resolveGenre(genre)
  return effectiveTemplate(`genre.${g}.plan`) || ''
}

/** 题材语境与取信标准（注入系统底座） */
export function genreVoice(genre) {
  const g = String(genre || '').trim()
  if (GENRE_DETECTABLE.includes(g)) {
    const t = effectiveTemplate(`genre.${g}.voice`)
    if (t) return t
  }
  return effectiveTemplate('genre.generic.voice') || GENERIC_VOICE
}

export function systemBase(tone = 'professional', genre = 'auto') {
  const base = effectiveTemplate('system.base')
  if (!base) return ''
  const contentPolicy = effectiveTemplate('policy.content') || ''
  return render(base, {
    contentPolicy,
    genreGuidance: genreVoice(genre),
    toneStyle: toneStyle(tone)
  })
}

/** 默认（严肃）底座（懒求值：避免模块加载时就访问数据库，那时表可能还没建） */
export function defaultSystemBase() {
  return systemBase('professional', 'auto')
}

/** 所有 JSON 输出的统一尾部指令 */
export const JSON_TAIL = `
【输出格式 —— 严格遵守】
- 只输出一个 JSON 对象，不要任何前言、解释、Markdown 标题。
- 可以用 \`\`\`json 代码块包裹，也可以直接输出裸 JSON。
- 不要输出你不确定的字段；可选字段缺失就省略，不要填 null 占位。
- 数组必须至少包含最低要求数量的元素。`
