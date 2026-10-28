/** 本地知识库检索适配器：FTS5 trigram + LIKE 降级 */
import * as kb from '../../db/repo/knowledge.js'
import { domainOf, truncate, contentHash } from '../../utils/text.js'

export class KnowledgeAdapter {
  constructor(cfg = {}) {
    this.name = 'knowledge'
    this.requiresKey = false
    this.timeoutMs = 2000
    this.maxPerQuery = cfg.maxPerQuery || 6
  }

  isAvailable() {
    try { return (kb.stats().chunks || 0) > 0 } catch { return false }
  }

  async search(query, { limit = 10 } = {}) {
    if (!this.isAvailable()) return []
    try {
      const rows = kb.search(query, Math.max(limit, 4))
      return rows.slice(0, Math.min(this.maxPerQuery, limit)).map(r => ({
        title: `${r.doc_title}${r.heading ? ' · ' + r.heading : ''}`,
        url: r.origin_url || `knowledge://${r.doc_id}#chunk-${r.ord}`,
        snippet: truncate(r.text, 500),
        domain: r.origin_url ? domainOf(r.origin_url) : '本地知识库',
        publishedAt: null,
        engine: this.name,
        authorityHint: r.authority_tier || 'C',
        chunkId: r.id,
        contentHash: contentHash(r.text)
      }))
    } catch {
      return []
    }
  }
}
