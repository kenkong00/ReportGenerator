import { q, one, run } from '../index.js'
import { v4 as uuid } from 'uuid'

export function createDocument({ title, sourceType = 'paste', originUrl = null, filePath = null,
  mime = null, author = null, publishedAt = null, authorityTier = 'C', tags = [], charCount = 0, projectId = null }) {
  const id = uuid()
  run(`INSERT INTO knowledge_documents(id, title, source_type, origin_url, file_path, mime, author,
       published_at, authority_tier, tags_json, char_count, status, project_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?, 'ready', ?)`,
    id, title, sourceType, originUrl, filePath, mime, author, publishedAt, authorityTier, tags, charCount, projectId)
  return one('SELECT * FROM knowledge_documents WHERE id = ?', id)
}

export function updateDocument(id, patch) {
  const allowed = ['title', 'char_count', 'chunk_count', 'status', 'error', 'authority_tier', 'published_at', 'author']
  const sets = []
  const args = []
  for (const [k, v] of Object.entries(patch)) {
    if (!allowed.includes(k)) continue
    sets.push(`${k} = ?`)
    args.push(v)
  }
  if (!sets.length) return
  args.push(id)
  run(`UPDATE knowledge_documents SET ${sets.join(', ')} WHERE id = ?`, ...args)
}

export function listDocuments({ limit = 100, offset = 0, keyword = '' } = {}) {
  if (keyword) {
    return q('SELECT * FROM knowledge_documents WHERE title LIKE ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
      `%${keyword}%`, limit, offset)
  }
  return q('SELECT * FROM knowledge_documents ORDER BY created_at DESC LIMIT ? OFFSET ?', limit, offset)
}

export function getDocument(id) {
  return one('SELECT * FROM knowledge_documents WHERE id = ?', id)
}

export function deleteDocument(id) {
  const chunks = q('SELECT id, fts_id FROM knowledge_chunks WHERE doc_id = ?', id)
  for (const c of chunks) {
    if (c.fts_id) {
      try { run('DELETE FROM knowledge_chunks_fts WHERE rowid = ?', c.fts_id) } catch {}
    }
  }
  run('DELETE FROM knowledge_chunks WHERE doc_id = ?', id)
  run('DELETE FROM knowledge_documents WHERE id = ?', id)
}

/** 分片 + 建 FTS 索引 */
export function addChunks(docId, chunks) {
  let total = 0
  chunks.forEach((c, i) => {
    const text = c.text || ''
    if (!text.trim()) return
    const r = run('INSERT INTO knowledge_chunks(doc_id, ord, heading, text, char_count) VALUES (?,?,?,?,?)',
      docId, i, c.heading || null, text, text.length)
    const chunkId = Number(r.lastInsertRowid)
    // FTS 外部内容表：用 rowid 直接对应
    const f = run('INSERT INTO knowledge_chunks_fts(rowid, heading, text) VALUES (?,?,?)',
      chunkId, c.heading || '', text)
    run('UPDATE knowledge_chunks SET fts_id = ? WHERE id = ?', chunkId, chunkId)
    total += text.length
  })
  run('UPDATE knowledge_documents SET chunk_count = ?, char_count = ? WHERE id = ?',
    chunks.length, total, docId)
  return chunks.length
}

/**
 * 全文检索：FTS5 trigram 优先，零结果降级为 LIKE。
 * trigram 要求查询词 ≥3 字符，短词直接走 LIKE。
 */
export function search(query, limit = 20) {
  const qy = String(query || '').trim()
  if (qy.length < 3) {
    return q(`SELECT c.*, d.title AS doc_title, d.authority_tier, d.origin_url
              FROM knowledge_chunks c JOIN knowledge_documents d ON d.id = c.doc_id
              WHERE c.text LIKE ? OR c.heading LIKE ? LIMIT ?`, `%${qy}%`, `%${qy}%`, limit)
  }
  // trigram 下把查询按空格切成短语，用 AND 连接
  const terms = qy.split(/\s+/).filter(t => t.length >= 3).map(t => `"${t.replace(/"/g, '')}"`)
  if (!terms.length) {
    return q(`SELECT c.*, d.title AS doc_title, d.authority_tier, d.origin_url
              FROM knowledge_chunks c JOIN knowledge_documents d ON d.id = c.doc_id
              WHERE c.text LIKE ? LIMIT ?`, `%${qy}%`, limit)
  }
  try {
    const match = terms.join(' AND ')
    const rows = q(`SELECT c.*, d.title AS doc_title, d.authority_tier, d.origin_url,
                           bm25(knowledge_chunks_fts) AS score
                    FROM knowledge_chunks_fts f
                    JOIN knowledge_chunks c ON c.id = f.rowid
                    JOIN knowledge_documents d ON d.id = c.doc_id
                    WHERE knowledge_chunks_fts MATCH ?
                    ORDER BY score LIMIT ?`, match, limit)
    if (rows.length) return rows
  } catch (e) {
    // FTS 语法问题（如引号不匹配）→ 降级
  }
  return q(`SELECT c.*, d.title AS doc_title, d.authority_tier, d.origin_url
            FROM knowledge_chunks c JOIN knowledge_documents d ON d.id = c.doc_id
            WHERE c.text LIKE ? LIMIT ?`, `%${qy.slice(0, 20)}%`, limit)
}

export function listChunks(docId) {
  return q('SELECT id, ord, heading, char_count FROM knowledge_chunks WHERE doc_id = ? ORDER BY ord', docId)
}

/** 把一份报告的章节与证据沉淀进知识库 */
export function sinkReport(projectId, runId, title) {
  const sections = q('SELECT * FROM report_sections WHERE project_id = ? AND run_id = ? ORDER BY ord', projectId, runId)
  if (!sections.length) return null
  const doc = createDocument({
    title: `[报告沉淀] ${title}`,
    sourceType: 'report',
    authorityTier: 'C',
    tags: ['报告沉淀'],
    projectId
  })
  const chunks = sections.map(s => ({
    heading: s.heading,
    text: `${(s.key_points_json ? JSON.parse(s.key_points_json || '[]') : []).join('\n')}\n\n${s.md}`
  }))
  addChunks(doc.id, chunks)
  return doc
}

export function stats() {
  return {
    documents: one('SELECT COUNT(*) c FROM knowledge_documents')?.c || 0,
    chunks: one('SELECT COUNT(*) c FROM knowledge_chunks')?.c || 0,
    chars: one('SELECT COALESCE(SUM(char_count),0) c FROM knowledge_documents')?.c || 0
  }
}
