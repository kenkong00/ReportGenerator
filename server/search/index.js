/**
 * 检索编排：多引擎聚合 + 自动降级链。
 *
 *   auto 模式：并行打【所有启用的免费引擎】→ 合并去重 → 按域名限流保证多样性
 *     ├─ duckduckgo（零 key 网页检索）
 *     ├─ bing（cn.bing.com 网页检索，零 key）
 *     ├─ baidu / sogou / so360（国内引擎，零 key；受本机网络影响）
 *     └─ 结果不足时补充：wikipedia → 本地知识库
 *
 *   也可通过设置 search.provider 固定单一引擎，或 search.engines 自定义启用列表。
 *   内容不做预过滤（安全搜索关闭），尺度由提示词层 policy.content 统一管理。
 */
import { BingRssAdapter } from './adapters/bing-rss.js'
import { BingAdapter } from './adapters/bing.js'
import { DuckDuckGoAdapter } from './adapters/duckduckgo.js'
import { BaiduAdapter, SogouAdapter, So360Adapter } from './adapters/cn-engines.js'
import { WikipediaAdapter } from './adapters/wikipedia.js'
import { KnowledgeAdapter } from './adapters/knowledge.js'
import { pLimit } from '../utils/async.js'
import { CONCURRENCY } from '../config.js'
import { filterRelevant } from './relevance.js'

/** 默认启用的联网引擎（顺序即优先级展示用） */
export const DEFAULT_ENGINES = ['duckduckgo', 'bing', 'baidu', 'sogou', 'so360']
/** 所有可选的联网引擎 */
export const WEB_ENGINES = ['duckduckgo', 'bing', 'baidu', 'sogou', 'so360', 'bing-rss']

export class SearchHub {
  constructor(settings = {}, { budget = null, emit = null } = {}) {
    this.settings = settings
    this.budget = budget
    this.emit = emit
    this.adapters = {
      duckduckgo: new DuckDuckGoAdapter(),
      bing: new BingAdapter(),
      baidu: new BaiduAdapter(),
      sogou: new SogouAdapter(),
      so360: new So360Adapter(),
      'bing-rss': new BingRssAdapter(),
      wikipedia: new WikipediaAdapter(),
      knowledge: new KnowledgeAdapter()
    }
    this.limiter = pLimit(CONCURRENCY.search)
    this.enginesUsed = new Set()
    this.engineCounts = {}          // 各引擎贡献条数
    this.totalResults = 0           // 整轮检索命中的来源总数（跨所有查询累计）
    this.filteredOut = 0            // 被相关性闸门剔除的无关结果数
    this.notes = []
  }

  /**
   * 是否「完全没联网」：整轮所有查询合计 0 条来源才算离线。
   * 单条查询空结果不会污染全局——这是之前的 bug（12 条查询里 1 条为空，
   * 整个 run 就被判成 offline，报告被错误标注为"未联网"）。
   */
  get offline() {
    return this.totalResults === 0
  }

  /** 本次启用的联网引擎列表 */
  resolveEngines() {
    const pref = this.settings['search.provider'] || 'auto'
    if (pref !== 'auto' && this.adapters[pref]) return [pref]
    const custom = this.settings['search.engines']
    if (Array.isArray(custom) && custom.length) return custom.filter(n => this.adapters[n])
    if (typeof custom === 'string' && custom.trim()) return custom.split(',').map(s => s.trim()).filter(n => this.adapters[n])
    return DEFAULT_ENGINES.slice()
  }

  /**
   * 检索一条查询：并行打多个引擎 → 合并去重 → 域名限流。
   */
  async search(query, { limit = 8, lang = 'zh', signal, anchors = null } = {}) {
    if (this.budget && !this.budget.can('searches')) {
      this.budget.degrade('search_budget_hit', '检索预算耗尽，停止新查询')
      return { results: [], engine: null, ok: false, error: 'budget' }
    }

    const engines = this.resolveEngines()
    const perEngine = Math.max(8, Math.ceil(limit / Math.max(1, engines.length)) + 4)

    // ---- 并行打所有引擎 ----
    const settled = await Promise.allSettled(engines.map(name => {
      const a = this.adapters[name]
      if (!a) return Promise.resolve({ name, results: [] })
      return this.limiter(async () => {
        try {
          const results = await a.search(query, { limit: perEngine, lang, signal })
          return { name, results: results || [] }
        } catch (e) {
          return { name, results: [], error: e.message }
        }
      })
    }))

    const all = []
    const seenUrl = new Set()
    const domainCount = {}
    const perDomainCap = Number(this.settings['search.perDomainCap']) || 3
    let lastError = null

    for (const s of settled) {
      if (s.status !== 'fulfilled') { lastError = s.reason?.message || lastError; continue }
      const { name, results } = s.value
      if (!results?.length) continue
      let used = 0
      for (const r of results) {
        if (!r?.url) continue
        const key = normalizeUrl(r.url)
        if (seenUrl.has(key)) continue
        const dom = r.domain || ''
        if (dom && (domainCount[dom] || 0) >= perDomainCap) continue
        seenUrl.add(key)
        if (dom) domainCount[dom] = (domainCount[dom] || 0) + 1
        all.push(r)
        used++
      }
      if (used > 0) {
        this.enginesUsed.add(name)
        this.engineCounts[name] = (this.engineCounts[name] || 0) + used
        this.totalResults += used
      }
    }

    if (this.budget && all.length) this.budget.spend('searches', 1)

    // ---- 联网结果为零时，才用维基 + 本地知识库兜底 ----
    // 注意：旧逻辑是 all.length < limit，导致只要某条查询没搜满 8 条就拉维基，
    // 而喂给维基的是未清洗的整句查询 → 返回"加拿大""驴交"之类的随机条目污染报告。
    if (all.length === 0) {
      for (const name of ['wikipedia', 'knowledge']) {
        if (all.length >= 5) break
        const a = this.adapters[name]
        if (!a || !a.isAvailable()) continue
        try {
          const k = await a.search(query, { limit: Math.min(3, 5 - all.length), lang })
          for (const r of (k || [])) {
            if (!r?.url) continue
            const key = normalizeUrl(r.url)
            if (seenUrl.has(key)) continue
            seenUrl.add(key)
            all.push(r)
            this.enginesUsed.add(name)
            this.engineCounts[name] = (this.engineCounts[name] || 0) + 1
            this.totalResults += 1
          }
        } catch {}
      }
    }

    // ---- 相关性闸门：剔除搜索引擎填充页 / 维基随机条目等与话题无关的结果 ----
    if (all.length && anchors && this.settings['search.relevanceGate'] !== false) {
      const res = filterRelevant(all, query, anchors)
      if (!res.rescued) {
        this.filteredOut = (this.filteredOut || 0) + res.dropped
        all.length = 0
        all.push(...res.kept)
      }
    }

    if (!all.length) {
      // 注意：不要在这里置 offline —— 单条查询为空不代表整轮离线，
      // offline 由 totalResults 累计值统一判定（见 getter offline）。
      return { results: [], engine: null, ok: false, error: lastError || 'no_results' }
    }

    return { results: all.slice(0, limit * 2), engine: primaryEngine(this.engineCounts), ok: true }
  }

  /**
   * 批量检索。并发由 search() 内部的 limiter 把关，这里只负责展开。
   */
  async searchMany(queries, { limit = 8, onEach, signal, anchors = null } = {}) {
    const out = new Array(queries.length)
    let done = 0
    const tasks = queries.map((q, i) => (async () => {
      let r
      try {
        r = await this.search(q.query, { limit, lang: q.lang, signal, anchors })
      } catch (e) {
        r = { results: [], engine: null, ok: false, error: String(e?.message || e) }
      }
      out[i] = { query: q, ...r }
      done++
      onEach?.(out[i], done, queries.length)
    })())
    await Promise.all(tasks)
    return out
  }

  /** 供报告标注用 */
  statusNote() {
    if (this.offline) {
      return '本次调研未能成功联网检索，以下结论仅基于模型已有知识，不代表最新事实。'
    }
    const webUsed = WEB_ENGINES.filter(n => this.enginesUsed.has(n))
    if (!webUsed.length) {
      if (this.enginesUsed.has('wikipedia') && this.enginesUsed.size === 1) {
        return '本次调研仅命中维基百科，未获取到通用网络搜索结果。'
      }
      if (this.enginesUsed.has('knowledge') && this.enginesUsed.size === 1) {
        return '本次调研仅命中本地知识库，未获取到网络来源。'
      }
      return '本次调研未获取到通用网络搜索结果，仅使用了本地知识源。'
    }
    return null
  }
}

function normalizeUrl(u) {
  try {
    const x = new URL(u)
    return (x.hostname + x.pathname).replace(/\/$/, '').toLowerCase()
  } catch { return String(u).toLowerCase() }
}

function primaryEngine(counts) {
  let best = null, n = -1
  for (const [k, v] of Object.entries(counts)) { if (v > n) { n = v; best = k } }
  return best
}
