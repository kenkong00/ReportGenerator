/**
 * JSON 解析防御链 —— 整个流水线的命脉。
 * 模型输出的 JSON 永远不能假设是干净的：可能有 ```json 围栏、前言后语、尾逗号、全角引号、BOM。
 */
import { validate, coerce } from '../utils/validate.js'

/** 从混杂文本里抠出 JSON 对象/数组 */
export function extractJson(text) {
  if (!text) return null
  let s = String(text)
    .replace(/^\uFEFF/, '')
    .replace(/^[\s\S]*?```(?:json)?\s*/i, '')   // 去掉 ```json 前缀
    .replace(/```\s*$/, '')                      // 去掉结尾围栏
    .trim()

  // 优先：完整的 ```json ... ``` 代码块
  const fence = String(text).match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) s = fence[1].trim()

  const candidates = []
  // 首 { 到末 }
  const a = s.indexOf('{'), b = s.lastIndexOf('}')
  if (a !== -1 && b > a) candidates.push(s.slice(a, b + 1))
  // 首 [ 到末 ]
  const c = s.indexOf('['), d = s.lastIndexOf(']')
  if (c !== -1 && d > c) candidates.push(s.slice(c, d + 1))
  candidates.push(s)

  for (const cand of candidates) {
    for (const cleaned of [cand, sanitize(cand)]) {
      try {
        return JSON.parse(cleaned)
      } catch {}
    }
  }
  return null
}

function sanitize(s) {
  return s
    .replace(/\u201C|\u201D/g, '"')      // 全角引号
    .replace(/\u2018|\u2019/g, "'")
    .replace(/,\s*([}\]])/g, '$1')       // 尾逗号
    .replace(/[\u0000-\u001F]+/g, ' ')   // 控制字符
    .replace(/\/\/[^\n]*/g, '')          // 行注释（简易）
}

/**
 * 调用 LLM 并拿到符合 schema 的 JSON。
 * 失败时做一次 self-repair：把校验错误回给模型重生成。
 */
export async function chatJson(llm, messages, schema, opts = {}) {
  const res = await llm.chat(messages, { ...opts, jsonMode: true })
  let parsed = extractJson(res.content)

  if (parsed != null) {
    parsed = coerce(parsed, schema)
    const errs = validate(parsed, schema)
    if (errs.length === 0) return { data: parsed, raw: res.content, usage: res.usage, repaired: false }
    // 一次 self-repair
    const repairMessages = [
      ...messages,
      { role: 'assistant', content: res.content.slice(0, 6000) },
      { role: 'user', content: `你上一次的输出无法被解析或不符合结构要求，具体错误如下：\n${errs.slice(0, 12).join('\n')}\n\n请只重新输出修正后的 JSON，不要任何解释。` }
    ]
    try {
      const r2 = await llm.chat(repairMessages, { ...opts, jsonMode: true })
      const p2 = coerce(extractJson(r2.content), schema)
      if (p2 != null) {
        const e2 = validate(p2, schema)
        if (e2.length === 0) {
          return {
            data: p2, raw: r2.content,
            usage: mergeUsage(res.usage, r2.usage), repaired: true
          }
        }
        return { data: p2, raw: r2.content, usage: mergeUsage(res.usage, r2.usage), repaired: true, warnings: e2 }
      }
    } catch (e) {
      if (e?.__pause) throw e            // 暂停不能被 self-repair 的 catch 吞掉
    }
    return { data: parsed, raw: res.content, usage: res.usage, repaired: true, warnings: errs }
  }

  // 完全没解析出来 → 再试一次（换措辞）
  const retryMessages = [
    ...messages,
    { role: 'user', content: '你刚才的输出没有包含可解析的 JSON。请只输出 JSON 代码块，不要任何前言后语。' }
  ]
  const r3 = await llm.chat(retryMessages, { ...opts, jsonMode: true })
  const p3 = coerce(extractJson(r3.content), schema)
  if (p3 == null) {
    const err = new Error('模型输出无法解析为 JSON')
    err.raw = r3.content
    err.code = 'json_unparseable'
    throw err
  }
  return { data: p3, raw: r3.content, usage: mergeUsage(res.usage, r3.usage), repaired: true }
}

function mergeUsage(a = {}, b = {}) {
  return {
    promptTokens: (a.promptTokens || 0) + (b.promptTokens || 0),
    completionTokens: (a.completionTokens || 0) + (b.completionTokens || 0)
  }
}
