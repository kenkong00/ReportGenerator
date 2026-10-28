/**
 * LLM 门面：provider 选择 / 并发限流 / 重试 / 预算记账 / 调用流水落库
 */
import { OpenAICompatProvider, HttpError } from './providers/openai-compat.js'
import { CloudProvider } from './providers/cloud.js'
import { chatJson } from './json.js'
import { pLimit, rateLimiter, withRetry } from '../utils/async.js'
import { estimateTokens } from '../utils/text.js'
import { PauseError, isPause } from '../utils/errors.js'
import * as stagesRepo from '../db/repo/stages.js'
import { CONCURRENCY, LLM_RATE_LIMIT } from '../config.js'

const limiter = pLimit(CONCURRENCY.llm)
const acquire = rateLimiter(LLM_RATE_LIMIT)

/** 错误分类：决定重试还是立即放弃 */
function classify(e) {
  const code = e?.code || ''
  const status = e?.status
  const msg = String(e?.message || '')

  if (status === 401 || status === 403 || /auth_/i.test(code) || /api.?key/i.test(msg)) {
    return { retry: false, kind: 'auth', hint: 'API Key 无效或没有权限，请到设置页检查' }
  }
  if (status === 400 || /request_/i.test(code)) {
    return { retry: false, kind: 'request', hint: `请求被拒绝：${msg.slice(0, 160)}` }
  }
  if (status === 429 || /quota_rate_limited/i.test(code) || /rate.?limit/i.test(msg)) {
    return { retry: true, kind: 'rate', hint: '触发限流，稍后重试' }
  }
  if (status >= 500 || /gateway_|model_|internal_/i.test(code)) {
    return { retry: true, kind: 'server', hint: '服务端错误' }
  }
  if (e?.code === 'stalled' || /stall/i.test(code)) {
    return { retry: true, kind: 'network', hint: '模型长时间无响应（本地模型可能已停止）' }
  }
  // 请求级超时，分两种（provider 会打标）：
  //   timeout_slow  —— 模型一直在吐字但没答完：重试还是同样慢，直接放弃
  //   timeout_stall —— 一个字都没吐出来（排队/连接卡住）：值得重试一次
  if (e?.code === 'timeout_slow') {
    return { retry: false, kind: 'timeout', hint: '模型太慢，超时时间内没答完（重试也是同样慢，已跳过）' }
  }
  if (e?.code === 'timeout_stall') {
    return { retry: true, kind: 'timeout', hint: '模型迟迟没有响应（可能被别的请求占着），重试一次' }
  }
  if (/超时|timeout|ECONNRESET|ETIMEDOUT|fetch failed/i.test(msg)) {
    return { retry: true, kind: 'network', hint: '网络超时' }
  }
  if (/json_unparseable/i.test(e?.code || '')) {
    return { retry: false, kind: 'json', hint: '模型输出无法解析为 JSON' }
  }
  // 思考型模型：预算全花在思考上，正文为空 —— 换模型才行，重试也没用
  if (e?.code === 'thinking_only') {
    return { retry: false, kind: 'model', hint: '当前模型是思考型模型，正文为空；请到设置页换一个 instruct 模型' }
  }
  return { retry: true, kind: 'unknown', hint: msg.slice(0, 160) }
}

export function buildProvider(settings, providerName = null) {
  const name = providerName || settings['llm.provider'] || 'compat'
  if (name === 'cloud') return CloudProvider.fromSettings(settings)
  return OpenAICompatProvider.fromSettings(settings)
}

/**
 * 创建绑定上下文的 llm 实例
 * @param {Object} ctx { settings, runId, projectId, stageKey, budget, emit }
 */
export function createLLM(ctx) {
  const provider = buildProvider(ctx.settings)

  async function record(res, purpose, messages, ok = true, err = null) {
    const promptChars = messages.map(m => m.content || '').join('').length
    stagesRepo.logLlmCall({
      runId: ctx.runId, projectId: ctx.projectId, stageKey: ctx.stageKey,
      provider: provider.name, model: res?.model || provider.model || '',
      purpose,
      promptChars,
      promptTokens: res?.usage?.promptTokens || estimateTokens(messages.map(m => m.content).join('')),
      completionChars: res?.content?.length || 0,
      completionTokens: res?.usage?.completionTokens || 0,
      latencyMs: res?.latencyMs || 0,
      ok: ok ? 1 : 0,
      errorCode: err?.code || null,
      error: err ? String(err.message).slice(0, 500) : null
    })
  }

  async function chat(messages, opts = {}) {
    const purpose = opts.purpose || 'text'
    // 暂停闸门：不打断正在跑的那一步，下一次调用前停下来（跑完的步骤已落库，可续跑）
    if (ctx.isPaused?.()) throw new PauseError('用户暂停：已完成的部分已保存，可随时继续')

    // 预算闸门：token 触顶则拒绝并降级
    if (ctx.budget && !ctx.budget.can('tokens', opts.reserveTokens || 4000)) {
      ctx.budget?.degrade('token_budget_hit', `${ctx.stageKey} 阶段 token 预算耗尽`)
      throw new BudgetError('token 预算耗尽')
    }

    await acquire()
    return limiter(async () => {
      const cls = { retry: true }
      try {
        const res = await withRetry(
          () => provider.chat(messages, opts),
          {
            retries: 2,
            delays: [1000, 3000, 8000],
            shouldRetry: (e) => classify(e).retry,
            onRetry: (e, attempt, delay) => {
              const c = classify(e)
              ctx.emit?.('stage.retry', {
                stageKey: ctx.stageKey, attempt: attempt + 1, delayMs: delay,
                reason: `${c.kind}: ${c.hint}`
              })
            }
          }
        )
        if (ctx.budget) {
          ctx.budget.spend('promptTokens', res.usage.promptTokens)
          ctx.budget.spend('completionTokens', res.usage.completionTokens)
          ctx.budget.spend('llmCalls', 1)
        }
        if (ctx.stageKey) {
          stagesRepo.addUsage(ctx.runId, ctx.stageKey, {
            promptTokens: res.usage.promptTokens,
            completionTokens: res.usage.completionTokens,
            llmCalls: 1
          })
        }
        await record(res, purpose, messages)
        return res
      } catch (e) {
        if (isPause(e)) throw e            // 暂停不是错误，不做重试/记账
        const c = classify(e)
        await record(null, purpose, messages, false, e)
        ctx.emit?.('stage.error', {
          stageKey: ctx.stageKey,
          error: { code: c.kind, message: String(e.message).slice(0, 300) },
          retryable: c.retry,
          hint: c.hint
        })
        throw e
      }
    })
  }

  async function json(messages, schema, opts = {}) {
    const r = await chatJson(
      { chat: (m, o) => chat(m, o) },
      messages, schema, { ...opts, purpose: opts.purpose || 'json' }
    )
    return r
  }

  /** 纯文本（流式增量通过 opts.onDelta 回调） */
  async function text(messages, opts = {}) {
    const res = await chat(messages, { ...opts, purpose: opts.purpose || 'text' })
    return res.content
  }

  return {
    provider,
    name: provider.name,
    model: provider.model || '',
    chat,
    json,
    text,
    _ctxRef: ctx,
    isConfigured: () => provider.isConfigured?.() ?? true
  }
}

export class BudgetError extends Error {
  constructor(msg) { super(msg); this.code = 'budget_exceeded'; this.name = 'BudgetError' }
}

/** 设置页用：测试连通性 */
export async function testConnection(settings, providerName = null) {
  const p = buildProvider(settings, providerName)
  if (!p.isConfigured()) {
    return { ok: false, code: 'not_configured', message: '未配置完整（baseUrl / apiKey / model）' }
  }
  const t0 = Date.now()
  try {
    if (p instanceof CloudProvider) return await p.selfCheck()
    const models = await p.listModels()
    const res = await p.chat([
      { role: 'system', content: 'You are a helpful assistant. Be concise and helpful.' },
      { role: 'user', content: '只回复两个字：可用' }
    ], { maxTokens: 20 })
    return {
      ok: true, code: 'ok',
      message: `连通正常（${Date.now() - t0}ms），模型 ${p.model} 回复：${res.content.slice(0, 30)}`,
      models: models.length ? models : []
    }
  } catch (e) {
    const c = classify(e)
    return { ok: false, code: c.kind, message: `${c.hint}｜${String(e.message).slice(0, 200)}` }
  }
}

export { HttpError }
