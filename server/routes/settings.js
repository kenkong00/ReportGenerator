import express from 'express'
import * as settingsRepo from '../db/repo/settings.js'
import * as dpRepo from '../db/repo/domainProfiles.js'
import { testConnection } from '../llm/index.js'
import { CloudProvider } from '../llm/providers/cloud.js'
import { setProxy } from '../search/http.js'
import { WEB_ENGINES } from '../search/index.js'

const router = express.Router()

/** 根据设置应用/取消检索代理 */
function applyProxy(settings) {
  const mode = settings['proxy.mode'] || 'off'
  const url = settings['proxy.url'] || ''
  if ((mode === 'on' || mode === 'auto') && url) return setProxy(url)
  setProxy(null)
  return false
}

const ENGINE_FACTORY = {
  duckduckgo: async () => (await import('../search/adapters/duckduckgo.js')).DuckDuckGoAdapter,
  bing: async () => (await import('../search/adapters/bing.js')).BingAdapter,
  baidu: async () => (await import('../search/adapters/cn-engines.js')).BaiduAdapter,
  sogou: async () => (await import('../search/adapters/cn-engines.js')).SogouAdapter,
  so360: async () => (await import('../search/adapters/cn-engines.js')).So360Adapter,
  'bing-rss': async () => (await import('../search/adapters/bing-rss.js')).BingRssAdapter,
  wikipedia: async () => (await import('../search/adapters/wikipedia.js')).WikipediaAdapter
}

router.get('/', (req, res) => {
  try {
    res.json({
      ok: true,
      settings: settingsRepo.getPublic(),
      secretKeys: settingsRepo.SECRET_KEYS,
      domainProfileCount: dpRepo.count()
    })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

router.put('/', (req, res) => {
  try {
    settingsRepo.savePublic(req.body || {})
    applyProxy(settingsRepo.getAll())
    res.json({ ok: true, settings: settingsRepo.getPublic() })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

/** 测试 LLM 连通性 */
router.post('/test-llm', async (req, res) => {
  try {
    const settings = settingsRepo.getAll()
    const provider = req.body?.provider || settings['llm.provider'] || 'compat'
    const r = await testConnection(settings, provider)

    // 云端通道的结果落库，供设置页显示三态
    if (provider === 'cloud') {
      settingsRepo.set('diag.cloudLlm', { ok: r.ok, code: r.code, message: r.message, checkedAt: new Date().toISOString() })
    }
    res.json({ ok: true, result: r })
  } catch (e) {
    res.json({ ok: false, result: { ok: false, code: 'exception', message: e.message } })
  }
})

/** 拉取模型列表 */
router.get('/models', async (req, res) => {
  try {
    const settings = settingsRepo.getAll()
    const provider = req.query.provider || settings['llm.provider'] || 'compat'
    if (provider === 'cloud') {
      const p = CloudProvider.fromSettings(settings)
      const models = await p.listModels()
      return res.json({ ok: true, models, diag: settingsRepo.get('diag.cloudLlm', null) })
    }
    const { OpenAICompatProvider } = await import('../llm/providers/openai-compat.js')
    const p = OpenAICompatProvider.fromSettings(settings)
    const models = await p.listModels()
    res.json({ ok: true, models })
  } catch (e) {
    res.json({ ok: false, error: e.message, models: [] })
  }
})

/**
 * 测试检索引擎。
 * - 不传 engine → 逐个测试全部联网引擎（前端"测试全部"，让用户看清哪些在本机可用）
 * - 传 engine → 只测该引擎
 */
router.post('/test-search', async (req, res) => {
  const q = req.body?.query || '比亚迪 刀片电池'
  const only = req.body?.engine
  const names = only ? [only] : WEB_ENGINES.slice()
  const results = []
  for (const name of names) {
    if (!ENGINE_FACTORY[name]) continue
    const t0 = Date.now()
    try {
      const Cls = await ENGINE_FACTORY[name]()
      const a = new Cls()
      const r = await a.search(q, { limit: 8 })
      const domains = [...new Set((r || []).map(x => x.domain).filter(Boolean))]
      results.push({
        engine: name, ok: (r || []).length > 0, count: (r || []).length,
        latencyMs: Date.now() - t0,
        domains: domains.slice(0, 6),
        sample: (r || []).slice(0, 3).map(x => ({ title: x.title, domain: x.domain, url: x.url })),
        error: a.lastError || null
      })
    } catch (e) {
      results.push({ engine: name, ok: false, count: 0, latencyMs: Date.now() - t0, error: e.message })
    }
  }
  res.json({ ok: true, query: q, results })
})

/** 域名画像 */
router.get('/domains', (req, res) => {
  try {
    res.json({ ok: true, items: dpRepo.list(req.query.tier || null) })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

router.put('/domains', (req, res) => {
  try {
    dpRepo.upsert(req.body || {})
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

export default router
