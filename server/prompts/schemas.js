/**
 * 各 stage 的输出 JSON Schema。
 * 配合 utils/validate.js 做校验，校验失败时把错误描述回给模型做一次 self-repair。
 */
import { JSON_TAIL } from './_common.js'
import { effectiveTemplate } from './render.js'

const T = {
  str: { type: 'string' },
  num: { type: 'number' },
  bool: { type: 'boolean' },
  arr: (items, minItems = 1) => ({ type: 'array', items, minItems }),
  obj: (properties, required = []) => ({ type: 'object', properties, required })
}

export const SCHEMAS = {
  clarify: T.obj({
    clarifiedTopic: T.str,
    questions: T.arr(T.obj({
      q: T.str,
      why: T.str,
      options: { type: 'array', items: T.str }
    }, ['q', 'why']), 1)
  }, ['clarifiedTopic', 'questions']),

  decompose: T.obj({
    genre: { type: 'string', enum: ['life', 'ent', 'society', 'biz', 'tech'] },
    subQuestions: T.arr(T.obj({
      ord: T.num,
      question: T.str,
      qtype: { type: 'string', enum: ['factual', 'numeric', 'opinion', 'forecast', 'causal'] },
      expectedSourceType: { type: 'string', enum: ['official', 'academic', 'industry', 'media', 'financial', 'ugc'] },
      perspectiveKey: T.str,
      priority: { type: 'number', enum: [1, 2, 3] },
      rationale: T.str
    }, ['question', 'qtype', 'expectedSourceType', 'priority', 'rationale']), 5)
  }, ['subQuestions']),

  perspectives: T.obj({
    perspectives: T.arr(T.obj({
      key: T.str,
      name: T.str,
      lens: T.str,
      keyMetrics: { type: 'array', items: T.str }
    }, ['key', 'name', 'lens']), 4)
  }, ['perspectives']),

  queryGen: T.obj({
    queries: T.arr(T.obj({
      query: T.str,
      lang: { type: 'string', enum: ['zh', 'en'] }
    }, ['query', 'lang']), 2)
  }, ['queries']),

  sourceEval: T.obj({
    evaluated: T.arr(T.obj({
      idx: T.num,
      tier: { type: 'string', enum: ['A', 'B', 'C', 'D', 'U'] },
      authorityScore: T.num,
      isPrimary: T.num,
      freshnessScore: T.num,
      relevanceScore: T.num,
      reason: T.str,
      keep: T.num
    }, ['idx', 'tier', 'keep', 'reason']), 1)
  }, ['evaluated']),

  evidenceExtract: T.obj({
    evidences: T.arr(T.obj({
      subQuestionId: T.num,
      claim: T.str,
      quote: T.str,
      factKey: T.str,
      polarity: { type: 'string', enum: ['support', 'refute', 'neutral'] },
      stance: { type: 'string', enum: ['official', 'academic', 'media', 'skeptic', 'vendor'] },
      confidence: { type: 'string', enum: ['high', 'medium', 'low', 'disputed'] },
      inference: T.num,
      inferenceChain: T.str,
      dataPoints: { type: 'array', items: T.obj({ label: T.str, value: T.str, unit: T.str, asOf: T.str }) }
    }, ['claim', 'quote', 'confidence']), 1)
  }, ['evidences']),

  crosscheck: T.obj({
    answered: T.arr(T.obj({
      subQuestionId: T.num,
      answer: T.str,
      confidence: { type: 'string', enum: ['high', 'medium', 'low', 'disputed'] },
      unresolved: T.num
    }, ['subQuestionId', 'answer', 'confidence']), 1),
    disagreements: { type: 'array', items: T.obj({
      subQuestionId: T.num,
      factKey: T.str,
      topic: T.str,
      positions: { type: 'array', items: T.obj({
        stance: T.str, claim: T.str, sourceIds: { type: 'array', items: T.num }, why: T.str
      }) },
      rootCause: { type: 'string', enum: ['口径差异', '时间点差异', '样本差异', '利益立场', '数据不可得', '其他'] },
      severity: { type: 'string', enum: ['high', 'medium', 'low'] },
      adjudication: { type: 'string', enum: ['adjudicated', 'unresolved', 'partially'] },
      verdict: T.str
    }, ['topic', 'rootCause', 'adjudication']) }
  }, ['answered']),

  outline: T.obj({
    title: T.str,
    sections: T.arr(T.obj({
      ord: T.num,
      level: T.num,
      heading: T.str,
      perspectiveKey: T.str,
      purpose: T.str,
      subQuestionIds: { type: 'array', items: T.num }
    }, ['heading', 'purpose']), 4)
  }, ['title', 'sections']),

  sectionWrite: T.obj({
    md: T.str,
    keyPoints: { type: 'array', items: T.str },
    unresolved: { type: 'array', items: T.str }
  }, ['md', 'keyPoints']),

  sectionExpand: T.obj({ md: T.str }, ['md']),

  executiveSummary: T.obj({
    summary: T.str,
    biggestDisagreement: T.str,
    weakestPart: T.str,
    limitations: T.str
  }, ['summary']),

  audit: T.obj({
    issues: { type: 'array', items: T.obj({
      type: { type: 'string', enum: ['no_evidence', 'logic_jump', 'missing_perspective', 'overconfident', 'stale_data', 'hollow_hedge', 'off_topic', 'vague_no_specifics', 'other'] },
      quote: T.str,
      severity: { type: 'string', enum: ['high', 'medium', 'low'] },
      suggestion: T.str
    }, ['type', 'quote']) }
  }, ['issues'])
}

/** 把 schema 渲染成给模型看的自然语言说明 */
export function describe(schema) {
  if (!schema) return ''
  const lines = []
  const walk = (s, path, depth) => {
    if (!s) return
    const ind = '  '.repeat(depth)
    if (s.type === 'object') {
      lines.push(`${ind}${path}: 对象`)
      for (const [k, v] of Object.entries(s.properties || {})) {
        const req = (s.required || []).includes(k) ? '（必填）' : '（可选）'
        walk(v, `${k}${req}`, depth + 1)
      }
    } else if (s.type === 'array') {
      const n = s.minItems ? `，至少 ${s.minItems} 项` : ''
      lines.push(`${ind}${path}: 数组${n}`)
      if (s.items) walk(s.items, `${path}[]`, depth + 1)
    } else {
      const e = s.enum ? `，只能是 ${s.enum.join(' / ')} 之一` : ''
      lines.push(`${ind}${path}: ${s.type}${e}`)
    }
  }
  walk(schema, '根对象', 0)
  return lines.join('\n')
}

/** 生成某个 schema 的默认说明文本（出厂默认；也会被播种成可编辑模板 schema.<name>） */
export function generateSchemaBlock(name) {
  const s = SCHEMAS[name]
  if (!s) return ''
  return `你的输出必须符合以下结构：\n\n${describe(s)}\n${JSON_TAIL}`
}

/** 全部 schema 的出厂默认（给 migrate 播种用） */
export function allSchemaTemplateDefaults() {
  const out = {}
  for (const name of Object.keys(SCHEMAS)) out['schema.' + name] = generateSchemaBlock(name)
  return out
}

/**
 * 取本步要求的 JSON 结构说明。
 * 优先用数据库里的 schema.<name> 模板（用户可改），没有则现场生成。
 * 注意：真正的结构校验仍以 SCHEMAS 为准（那是硬契约，不属于"提示词"）。
 */
export function schemaBlock(name) {
  const t = effectiveTemplate('schema.' + name)
  if (t) return `\n${t}`
  const g = generateSchemaBlock(name)
  return g ? `\n${g}` : ''
}
