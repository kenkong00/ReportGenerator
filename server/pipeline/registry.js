import * as clarify from './stages/00-clarify.js'
import * as decompose from './stages/01-decompose.js'
import * as perspectives from './stages/02-perspectives.js'
import * as search from './stages/03-search.js'
import * as sourceEval from './stages/04-source-eval.js'
import * as extract from './stages/05-extract.js'
import * as crosscheck from './stages/06-crosscheck.js'
import * as draft from './stages/07-draft.js'
import * as render from './stages/08-render.js'
import * as audit from './stages/09-audit.js'

export const REGISTRY = {
  clarify: clarify.run,
  decompose: decompose.run,
  perspectives: perspectives.run,
  search: search.run,
  source_eval: sourceEval.run,
  extract: extract.run,
  crosscheck: crosscheck.run,
  draft: draft.run,
  render: render.run,
  audit: audit.run
}

/** 这些阶段失败必须终止整条流水线 */
export const FATAL_STAGES = new Set(['decompose', 'draft', 'render'])

/**
 * 交付物阶段：无论预算怎么触顶、无论前面发生什么，只要前面已有素材就必须跑完，
 * 因为它们是「报告」的唯一出口。runner 在预算触顶后只保留这些阶段。
 */
export const DELIVERABLE_STAGES = new Set(['render', 'audit'])

/** 这些阶段在 M1 默认跳过 */
export const OPTIONAL_STAGES = new Set(['clarify'])

export function impl(key) {
  return REGISTRY[key]
}
