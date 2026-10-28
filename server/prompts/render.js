/**
 * 模板渲染引擎（极简、无依赖）。
 * 运行时提示词一律来自数据库（prompt_templates），这里负责把 {{变量}} 填进去。
 */
import * as promptsRepo from '../db/repo/prompts.js'
import { DEFAULT_TEMPLATES } from './defaults.js'

const BUILTIN_MAP = Object.fromEntries(DEFAULT_TEMPLATES.map(t => [t.key, t.template]))

/** 把模板里的 {{name}} 替换为 vars[name]（缺失则替换为空串，避免残留占位符） */
export function render(template, vars = {}) {
  if (!template) return ''
  return String(template).replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, name) => {
    const v = vars[name]
    return v === undefined || v === null ? '' : String(v)
  })
}

/** 取「生效模板文本」：DB 里存在就用 DB（停用则回退出厂默认），否则用代码里的出厂默认 */
export function effectiveTemplate(key) {
  const t = promptsRepo.effective(key)
  if (t !== null && t !== undefined && t !== '') return t
  return BUILTIN_MAP[key] ?? null
}

/** 取模板并渲染 */
export function renderPrompt(key, vars = {}) {
  const tpl = effectiveTemplate(key)
  if (tpl === null) return ''
  return render(tpl, vars)
}

/** 该模板是否在 DB 里登记（用于前端展示/校验） */
export function has(key) {
  return !!promptsRepo.get(key) || key in BUILTIN_MAP
}
