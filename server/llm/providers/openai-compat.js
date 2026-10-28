/**
 * OpenAI 兼容 provider（主力通道）。
 * 原生 fetch，不装任何 SDK —— 切厂商零成本。
 * 支持：DeepSeek / 硅基流动 / 阿里通义 DashScope 兼容模式 / OpenRouter / OpenAI / 本地 vLLM-OAI
 */
import { estimateTokens } from '../../utils/text.js'

const DEFAULT_UA = 'deep-research-report/0.1'

function normalizeBase(base) {
  let b = String(base || '').trim().replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(b)) b = 'https://' + b
  if (!/\/v\d+$/.test(b) && !/\/api\/v\d+$/.test(b)) b += '/v1'
  return b
}

/** 流式读取的停滞错误：连接还在但迟迟没有新数据（本地模型崩了 / 服务挂起的典型症状） */
export class StallError extends Error {
  constructor(ms) {
    super(`模型 ${Math.round(ms / 1000)} 秒未返回任何新数据（可能已停止响应）`)
    this.name = 'StallError'
    this.code = 'stalled'
  }
}

/** 解析 SSE 流：逐行读 data:，返回增量回调。stallMs>0 时启用停滞看门狗。 */
async function readSSE(res, onDelta, onReasoning, stallMs = 0, onStall = null) {
  const reader = res.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buf = ''
  let content = ''
  let reasoning = ''
  let usage = null
  let finishReason = null

  while (true) {
    let pending
    if (stallMs > 0) {
      let timer = null
      pending = Promise.race([
        reader.read(),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new StallError(stallMs)), stallMs)
        })
      ]).finally(() => clearTimeout(timer))
    } else {
      pending = reader.read()
    }

    const { done, value } = await pending
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop() ?? ''
    for (const line of lines) {
      const t = line.trim()
      if (!t || t.startsWith(':')) continue
      if (!t.startsWith('data:')) continue
      const payload = t.slice(5).trim()
      if (payload === '[DONE]') continue
      let j
      try { j = JSON.parse(payload) } catch { continue }
      if (j.usage) usage = j.usage
      const ch = j.choices?.[0]
      if (!ch) continue
      if (ch.finish_reason) finishReason = ch.finish_reason
      const d = ch.delta || {}
      if (typeof d.content === 'string' && d.content) {
        content += d.content
        onDelta?.(d.content)
      }
      // DeepSeek-R1 / QwQ 等推理模型的思维链
      const rc = d.reasoning_content ?? d.reasoning
      if (typeof rc === 'string' && rc) {
        reasoning += rc
        onReasoning?.(rc)
      }
    }
  }
  return { content, reasoning, usage, finishReason }
}

export class OpenAICompatProvider {
  constructor(cfg = {}) {
    this.name = 'openai-compat'
    this.baseUrl = normalizeBase(cfg.baseUrl)
    this.apiKey = cfg.apiKey || ''
    this.model = cfg.model || 'deepseek-chat'
    this.temperature = cfg.temperature ?? 0.3
    this.timeoutMs = Number(cfg.timeoutMs) || 180000
    this.stallMs = Number(cfg.stallMs) || 90000
    this.maxOutputTokens = Number(cfg.maxOutputTokens) || 0
  }

  static fromSettings(s) {
    return new OpenAICompatProvider({
      baseUrl: s['llm.compat.baseUrl'],
      apiKey: s['llm.compat.apiKey'],
      model: s['llm.compat.model'],
      temperature: s['llm.compat.temperature'],
      timeoutMs: s['llm.compat.timeoutMs'],
      stallMs: s['llm.compat.stallMs'],
      maxOutputTokens: s['llm.maxOutputTokens']
    })
  }

  isConfigured() {
    return !!(this.baseUrl && this.apiKey && this.model)
  }

  /** 某些本地推理服务（LM Studio / llama.cpp / Ollama-OAI）不支持 response_format=json_object，
   *  只接受 json_schema 或 text。首次被拒后记住，后续请求直接跳过（改靠提示词约束 + json.js 防御解析）。 */
  supportsJsonObject() {
    return this._noJsonObject !== true
  }

  async listModels() {
    if (!this.apiKey) return []
    try {
      const r = await fetch(`${this.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${this.apiKey}`, 'User-Agent': DEFAULT_UA },
        signal: AbortSignal.timeout(20000)
      })
      if (!r.ok) return []
      const j = await r.json()
      return (j.data || []).map(m => ({ id: m.id, label: m.id }))
    } catch {
      return []
    }
  }

  /**
   * @param {Array<{role:string,content:string}>} messages messages[0] 必须是 system
   * @param {Object} opts { temperature, maxTokens, jsonMode, onDelta, onReasoning, signal }
   */
  async chat(messages, opts = {}) {
    if (!this.isConfigured()) throw new Error('LLM 未配置：缺少 baseUrl / apiKey / model')
    if (!messages?.length || messages[0].role !== 'system') {
      throw new Error('messages[0] 必须是 system 角色')
    }

    const body = {
      model: this.model,
      messages,
      stream: true,
      temperature: opts.temperature ?? this.temperature
    }
    if (opts.maxTokens) body.max_tokens = opts.maxTokens
    else if (this.maxOutputTokens > 0) body.max_tokens = this.maxOutputTokens
    if (opts.jsonMode && this.supportsJsonObject()) body.response_format = { type: 'json_object' }

    const t0 = Date.now()
    const ac = new AbortController()
    // 记录「模型到底吐没吐过字」，用来区分两种超时：
    //   一个字都没吐 → 多半是请求排队/连接卡住，值得重试；
    //   吐了半天没答完 → 模型就是慢，重试只会再白等一个超时周期。
    let sawData = false
    const userOnDelta = opts.onDelta
    const userOnReasoning = opts.onReasoning
    const markDelta = (d) => { if (d) sawData = true }
    const timer = setTimeout(() => ac.abort(), opts.timeoutMs || this.timeoutMs)
    if (opts.signal) opts.signal.addEventListener('abort', () => ac.abort(), { once: true })

    const doFetch = () => fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
        'User-Agent': DEFAULT_UA
      },
      body: JSON.stringify(body),
      signal: ac.signal
    })

    let res
    try {
      res = await doFetch()
      // 本地推理服务常不认 json_object：自动去掉 response_format 重试一次
      if (!res.ok && body.response_format) {
        const errTxt = await res.text().catch(() => '')
        if (res.status === 400 && /response_format|json_object|json mode/i.test(errTxt)) {
          this._noJsonObject = true
          delete body.response_format
          res = await doFetch()
        } else {
          clearTimeout(timer)
          throw new HttpError(res.status, errTxt)
        }
      }
    } catch (e) {
      clearTimeout(timer)
      if (e instanceof HttpError) throw e
      if (e.name === 'AbortError') {
        // 还没拿到响应头就被掐断：纯排队/连接问题
        const err = new Error(`模型 ${Math.round((opts.timeoutMs || this.timeoutMs) / 1000)} 秒内没有任何响应`)
        err.code = 'timeout_stall'
        throw err
      }
      throw new Error(`LLM 网络错误：${e.message}`)
    }

    if (!res.ok) {
      clearTimeout(timer)
      const txt = await res.text().catch(() => '')
      throw new HttpError(res.status, txt)
    }

    let out
    try {
      out = await readSSE(
        res,
        (d) => { markDelta(d); userOnDelta?.(d) },
        (d) => { markDelta(d); userOnReasoning?.(d) },
        this.stallMs
      )
    } catch (e) {
      // 停滞/读流异常：务必掐断底层连接，否则句柄泄漏、进程退不出去
      try { ac.abort() } catch {}
      if (e?.name === 'AbortError') {
        const err = new Error(sawData
          ? `模型已经在输出，但 ${Math.round((opts.timeoutMs || this.timeoutMs) / 1000)} 秒内没答完（模型太慢）`
          : `模型 ${Math.round((opts.timeoutMs || this.timeoutMs) / 1000)} 秒内没有任何输出`)
        err.code = sawData ? 'timeout_slow' : 'timeout_stall'
        throw err
      }
      throw e
    } finally {
      clearTimeout(timer)
    }

    const promptTokens = out.usage?.prompt_tokens ?? estimateTokens(messages.map(m => m.content).join(''))
    const completionTokens = out.usage?.completion_tokens ?? estimateTokens(out.content)

    // 思考型模型（reasoning 模型）的典型症状：预算被思考过程吃光，正文一个字都没有。
    // 不说清楚的话上层只会报「无法解析 JSON」，用户根本找不到原因。
    if (!String(out.content || '').trim() && String(out.reasoning || '').trim()) {
      const err = new Error('模型只输出了思考过程、没有输出正文（思考型模型不适合本流水线，请换成 instruct 模型）')
      err.code = 'thinking_only'
      throw err
    }

    return {
      content: out.content,
      reasoning: out.reasoning,
      finishReason: out.finishReason,
      usage: { promptTokens, completionTokens },
      latencyMs: Date.now() - t0,
      model: this.model,
      provider: this.name
    }
  }
}

export class HttpError extends Error {
  constructor(status, bodyText) {
    let msg = `HTTP ${status}`
    let code = `http_${status}`
    try {
      const j = JSON.parse(bodyText)
      msg = j.error?.message || j.message || bodyText.slice(0, 300)
      if (j.error?.code) code = String(j.error.code)
    } catch {
      if (bodyText) msg = bodyText.slice(0, 300)
    }
    super(msg)
    this.status = status
    this.code = code
    this.name = 'HttpError'
  }
}
