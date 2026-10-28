/**
 * WorkBuddy 云端免密钥 provider（备选通道）。
 *
 * 已知约束（来自官方 skill 文档）：
 * - publishableKey 依赖 Origin 精确匹配，Node 进程没有浏览器 Origin → 大概率 auth_* 失败
 * - 官方 Forbidden Patterns 明确包含「Node 端 BFF 代理调模型」
 * - 必须 stream:true；模型必须运行时拉取；messages[0] 必须 system
 *
 * 因此本 provider 只做「尽力而为」，失败时把 error.code 记录到 settings.diag.cloudLlm，
 * 由设置页展示三态：可用 / Node 环境不可用 / 未激活。不阻塞主线。
 */

export class CloudProvider {
  constructor(cfg = {}) {
    this.name = 'cloud'
    this.endpoint = cfg.endpoint || ''
    this.publishableKey = cfg.publishableKey || ''
    this.resourceId = cfg.resourceId || ''
    this.modelId = cfg.modelId || ''
    this.sdk = null
    this.cloud = null
    this.initError = null
  }

  static fromSettings(s) {
    return new CloudProvider({
      endpoint: s['llm.cloud.endpoint'],
      publishableKey: s['llm.cloud.publishableKey'],
      resourceId: s['llm.cloud.resourceId'],
      modelId: s['llm.cloud.modelId']
    })
  }

  isConfigured() {
    return !!(this.endpoint && this.publishableKey)
  }

  async _ensure() {
    if (this.cloud) return this.cloud
    try {
      const mod = await import('@tencent-ai/workbuddy-cloud-sdk')
      const create = mod.createWorkBuddyCloud || mod.default?.createWorkBuddyCloud
      if (!create) throw new Error('SDK 未导出 createWorkBuddyCloud')
      this.cloud = create({ endpoint: this.endpoint, publishableKey: this.publishableKey })
      return this.cloud
    } catch (e) {
      this.initError = e.message
      throw new Error(`云端 SDK 初始化失败：${e.message}`)
    }
  }

  async listModels() {
    try {
      const cloud = await this._ensure()
      const list = await cloud.llm.models.list()
      const arr = Array.isArray(list) ? list : (list?.data || list?.models || [])
      return arr.filter(m => m.disabled !== true).map(m => ({ id: m.id, label: m.id, supportsReasoning: !!m.supportsReasoning }))
    } catch (e) {
      return []
    }
  }

  /** 自检：给设置页用，返回 {ok, code, message} */
  async selfCheck() {
    if (!this.isConfigured()) return { ok: false, code: 'not_configured', message: '未配置 endpoint / publishableKey' }
    try {
      const cloud = await this._ensure()
      const models = await this.listModels()
      const model = this.modelId || models[0]?.id
      if (!model) return { ok: false, code: 'no_model', message: '模型列表为空' }
      const stream = await cloud.llm.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: 'You are a helpful assistant. Be concise and helpful.' },
          { role: 'user', content: '只回复两个字：可用' }
        ],
        stream: true
      })
      let text = ''
      for await (const chunk of stream) {
        text += chunk?.choices?.[0]?.delta?.content || ''
      }
      return { ok: true, code: 'ok', message: `连通正常，模型 ${model} 回复：${text.slice(0, 20)}`, models }
    } catch (e) {
      return { ok: false, code: e?.code || 'unknown', message: e?.message || String(e), models: [] }
    }
  }

  async chat(messages, opts = {}) {
    const cloud = await this._ensure()
    if (!messages?.length || messages[0].role !== 'system') {
      throw new Error('messages[0] 必须是 system 角色')
    }
    const model = opts.model || this.modelId
    if (!model) throw new Error('未指定模型，请先拉取模型列表')

    const t0 = Date.now()
    const stream = await cloud.llm.chat.completions.create({
      model,
      messages,
      stream: true,
      temperature: opts.temperature ?? 0.3
    })

    let content = ''
    let reasoning = ''
    for await (const chunk of stream) {
      const d = chunk?.choices?.[0]?.delta || {}
      if (d.content) {
        content += d.content
        opts.onDelta?.(d.content)
      }
      if (d.reasoning_content) {
        reasoning += d.reasoning_content
        opts.onReasoning?.(d.reasoning_content)
      }
    }
    return {
      content,
      reasoning,
      usage: {
        promptTokens: opts.estimatePromptTokens || 0,
        completionTokens: Math.ceil(content.length / 1.6)
      },
      latencyMs: Date.now() - t0,
      model,
      provider: this.name
    }
  }
}
