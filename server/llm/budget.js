/**
 * 预算闸门。超预算不失败，而是返回降级动作 —— 报告里必须显式声明做了哪些降级。
 */
export class Budget {
  constructor(preset = {}, mode = 'standard') {
    this.mode = mode
    this.maxSearches = preset.maxSearches ?? 30
    this.maxFetches = preset.maxFetches ?? 20
    this.maxTokens = preset.maxTokens ?? 600_000
    this.maxWallClockMs = preset.maxWallClockMs ?? 15 * 60_000
    this.startedAt = Date.now()

    this.used = { searches: 0, fetches: 0, promptTokens: 0, completionTokens: 0, llmCalls: 0 }
    this.degradations = []
    this.warned = new Set()
  }

  get elapsedMs() { return Date.now() - this.startedAt }
  get tokens() { return this.used.promptTokens + this.used.completionTokens }

  spend(kind, n = 1) {
    if (kind in this.used) this.used[kind] += n
  }

  ratios() {
    return {
      searches: this.used.searches / this.maxSearches,
      fetches: this.used.fetches / this.maxFetches,
      tokens: this.tokens / this.maxTokens,
      wallclock: this.elapsedMs / this.maxWallClockMs
    }
  }

  /** 达到 80% 返回警告（每种只报一次） */
  warnings() {
    const out = []
    const ratios = this.ratios()
    for (const [k, v] of Object.entries(ratios)) {
      if (v >= 0.8 && !this.warned.has(k)) {
        this.warned.add(k)
        out.push({ metric: k, used: this.usedOf(k), limit: this.limitOf(k), ratio: Number(v.toFixed(2)) })
      }
    }
    return out
  }

  /** 某项已用量（wallclock 是毫秒、tokens 是提示+补全，其余取累计计数） */
  usedOf(k) {
    if (k === 'wallclock') return this.elapsedMs
    if (k === 'tokens') return this.tokens
    return this.used[k] ?? 0
  }

  limitOf(k) {
    return { searches: this.maxSearches, fetches: this.maxFetches, tokens: this.maxTokens, wallclock: this.maxWallClockMs }[k]
  }

  /** 检查某项是否触顶 */
  hit(kind) {
    const map = {
      searches: this.used.searches >= this.maxSearches,
      fetches: this.used.fetches >= this.maxFetches,
      tokens: this.tokens >= this.maxTokens,
      wallclock: this.elapsedMs >= this.maxWallClockMs
    }
    return map[kind] || false
  }

  can(kind, n = 1) {
    if (kind === 'searches') return this.used.searches + n <= this.maxSearches
    if (kind === 'fetches') return this.used.fetches + n <= this.maxFetches
    if (kind === 'tokens') return this.tokens + n <= this.maxTokens
    if (kind === 'wallclock') return this.elapsedMs < this.maxWallClockMs
    return true
  }

  /** 记录一次降级（必须写进报告） */
  degrade(action, reason) {
    if (!this.degradations.some(d => d.action === action)) {
      this.degradations.push({ action, reason, at: new Date().toISOString() })
    }
  }

  summary() {
    return {
      mode: this.mode,
      used: { ...this.used, tokens: this.tokens, elapsedMs: this.elapsedMs },
      limits: {
        maxSearches: this.maxSearches, maxFetches: this.maxFetches,
        maxTokens: this.maxTokens, maxWallClockMs: this.maxWallClockMs
      },
      degradations: this.degradations
    }
  }
}
