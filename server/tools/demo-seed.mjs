/**
 * 把「中国的男女对立问题」演示报告灌进系统数据库。
 * 运行：node server/tools/demo-seed.mjs
 */
import crypto from 'node:crypto'
import { exec, one, q, run, tx } from '../db/index.js'
import { PINNED_SOURCES, EVIDENCES, DISAGREEMENTS, SECTIONS, PERSPECTIVES, SUB_QUESTIONS, STAGES, realSources } from './demo-data.mjs'
import fs from 'node:fs'
import path from 'node:path'

const TOPIC = '中国的男女对立问题'
const PROJECT_ID = crypto.randomUUID()
const RUN_ID = crypto.randomUUID()

function hashUrl(u) {
  return crypto.createHash('sha1').update(String(u)).digest('hex')
}

/** run 的便捷包装：接受参数数组 */
function R(sql, arr) { return run(sql, ...(arr || [])) }

// ---------- 清理旧的演示数据 ----------
const old = q(`SELECT id FROM projects WHERE raw_topic = ?`, TOPIC)
for (const r of old) run('DELETE FROM projects WHERE id = ?', r.id)

// ---------- 1. project + run ----------
R(`INSERT INTO projects (id,title,raw_topic,clarified_topic,mode,status,language,budget_json,options_json,current_run_id)
  VALUES (?,?,?,?,?,?,?,?,?,?)`, [
  PROJECT_ID, TOPIC, TOPIC,
  '限定：中国大陆；时间范围 2020 年后；讨论社会现象层面（舆论/行为/结构三层），不含具体个案与人身评价',
  'deep', 'done', 'zh',
  JSON.stringify({ maxSearches: 30, maxFetches: 20, maxTokens: 400000 }),
  JSON.stringify({ demo: true, offlineNotice: false }),
  RUN_ID
])

R(`INSERT INTO runs (id,project_id,seq,trigger,status,current_stage,started_at,finished_at,stats_json)
  VALUES (?,?,?,?,?,?,?,?,?)`, [
  RUN_ID, PROJECT_ID, 1, 'manual', 'succeeded', 'audit',
  '2026-10-07 05:40:00', '2026-10-07 05:43:12',
  JSON.stringify({ searches: 28, fetches: 15, llmCalls: 18, tokens: 214000 })
])

// ---------- 2. perspectives ----------
const perspIds = {}
for (const p of PERSPECTIVES) {
  const r = R(`INSERT INTO perspectives (project_id,run_id,key,name,lens,key_metrics_json,ord,enabled)
    VALUES (?,?,?,?,?,?,?,1)`, [PROJECT_ID, RUN_ID, p.key, p.name, p.lens, JSON.stringify(p.key_metrics), p.ord])
  perspIds[p.key] = r.lastInsertRowid
}

// ---------- 3. sub_questions ----------
const sqIds = {}
for (let i = 0; i < SUB_QUESTIONS.length; i++) {
  const s = SUB_QUESTIONS[i]
  const r = R(`INSERT INTO sub_questions (project_id,run_id,ord,question,qtype,expected_source_type,perspective_key,priority,rationale,status,answer,confidence,answered_by_stage)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
    PROJECT_ID, RUN_ID, i + 1, s.question, s.qtype, s.expected_source_type, s.perspective_key, s.priority,
    '', s.status, s.answer, s.confidence, 'crosscheck'
  ])
  sqIds[i] = r.lastInsertRowid
}

// ---------- 4. sources ----------
// 4a. 权威源（优先插入，保证 id 靠前）
const srcIdByUrl = new Map()
for (const s of PINNED_SOURCES) {
  const h = hashUrl(s.url)
  if (srcIdByUrl.has(h)) continue
  const r0 = R(`INSERT OR IGNORE INTO sources (project_id,url,url_hash,title,snippet,domain,site_name,published_at,retrieved_at,language,
    authority_tier,authority_score,is_primary,freshness_score,relevance_score,quality_score,eval_reason,fetch_status,from_engine,in_report)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)`, [
    PROJECT_ID, s.url, h, s.title, s.snippet, s.domain, s.site_name, s.published_at,
    '2026-10-07 05:41:00', 'zh', s.authority_tier, s.authority_score, s.is_primary ? 1 : 0,
    0.9, 0.85, s.authority_score, s.note || '', 'ok', 'pinned'
  ])
  if (r0.lastInsertRowid) { srcIdByUrl.set(s.url, r0.lastInsertRowid); continue }
  const row = one(`SELECT id FROM sources WHERE project_id=? AND url_hash=?`, PROJECT_ID, h)
  if (row) srcIdByUrl.set(s.url, row.id)
}

// 4b. 系统真实检索到的来源（作为过程证据，取前 45 条）
const real = realSources().slice(0, 45)
let realCount = 0
for (const r of real) {
  const h = hashUrl(r.url)
  if (srcIdByUrl.has(r.url)) continue
  const exists = one(`SELECT id FROM sources WHERE project_id=? AND url_hash=?`, PROJECT_ID, h)
  if (exists) { srcIdByUrl.set(r.url, exists.id); continue }
  const r1 = R(`INSERT INTO sources (project_id,url,url_hash,title,snippet,domain,site_name,published_at,retrieved_at,language,
    authority_tier,authority_score,is_primary,freshness_score,relevance_score,quality_score,eval_reason,fetch_status,from_engine,in_report)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)`, [
    PROJECT_ID, r.url, h, (r.title || '').slice(0, 300), (r.snippet || '').slice(0, 600), r.domain,
    r.domain, r.publishedAt || null, '2026-10-07 05:41:00', 'zh',
    r.tier || 'U', r.score ?? 0.4, r.isPrimary ?? 0, r.freshness ?? 0.5, r.relevance ?? 0.5, r.quality ?? 0.4,
    r.note || `Bing RSS 检索：${r.sq || ''}`, 'not_attempted', 'bing-rss'
  ])
  if (r1.lastInsertRowid) { srcIdByUrl.set(r.url, r1.lastInsertRowid); realCount++ }
}

// ---------- 5. evidences（建立 fact_key → id 映射） ----------
const evIdByKey = {}
for (const e of EVIDENCES) {
  const sid = srcIdByUrl.get(e.source_url)
  if (!sid) { console.warn('未找到来源:', e.source_url); continue }
  const rr = R(`INSERT INTO evidences (project_id,source_id,sub_question_id,perspective_key,claim,quote,data_json,fact_key,
    polarity,stance,confidence,confidence_rule,confidence_llm,confidence_reason,inference,inference_chain,used_in_report)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)`, [
    PROJECT_ID, sid, null, null, e.claim, e.quote, JSON.stringify(e.data || []), e.fact_key,
    e.polarity || 'neutral', e.stance || 'media',
    e.confidence, e.confidence || e.confidence_rule, e.confidence_llm || e.confidence, e.confidence_reason,
    e.inference ? 1 : 0, e.inference_chain || null
  ])
  evIdByKey[e.fact_key] = rr.lastInsertRowid
}

function bindEvidence(md) {
  return String(md || '').replace(/\[\[ev:([A-Za-z0-9_]+)\]\]/g, (full, key) => {
    const id = evIdByKey[key]
    return id ? `[[ev:${id}]]` : full
  })
}

// ---------- 6. report_sections ----------
for (let i = 0; i < SECTIONS.length; i++) {
  const s = SECTIONS[i]
  const evIds = [...String(s.md || '').matchAll(/\[\[ev:([A-Za-z0-9_]+)\]\]/g)]
    .map(m => evIdByKey[m[1]]).filter(Boolean)
  R(`INSERT INTO report_sections (project_id,run_id,ord,level,perspective_key,heading,md,md_brief,md_deep,
    key_points_json,evidence_ids_json,unresolved_json,status)
    VALUES (?,?,?,2,?,?,?,?,?,?,?,?,?)`, [
    PROJECT_ID, RUN_ID, i, s.perspective_key, s.heading,
    bindEvidence(s.md), bindEvidence(s.md_brief), bindEvidence(s.md_deep),
    JSON.stringify([]), JSON.stringify([...new Set(evIds)]), JSON.stringify([]), 'audited'
  ])
}

// ---------- 7. disagreements ----------
for (let i = 0; i < DISAGREEMENTS.length; i++) {
  const d = DISAGREEMENTS[i]
  R(`INSERT INTO disagreements (project_id,run_id,sub_question_id,fact_key,topic,positions_json,root_cause,severity,adjudication,adjudication_reason,verdict,ord)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, [
    PROJECT_ID, RUN_ID, null, d.fact_key, d.topic, JSON.stringify(d.positions), d.root_cause,
    d.severity, d.adjudication, d.adjudication_reason || null, d.verdict || null, i
  ])
}

// ---------- 8. 组装三档报告 ----------
function assemble(field) {
  const parts = []
  for (const s of SECTIONS) parts.push(`## ${s.heading}\n\n${bindEvidence(s[field] || s.md)}`)
  return parts.join('\n\n---\n\n')
}

const BRIEF_MD = assemble('md_brief')
const STD_MD = assemble('md')
const DEEP_MD = assemble('md_deep')

function wc(md) { return String(md).replace(/\s+/g, '').length }

const QUALITY = {
  issueCount: 4,
  issues: [
    { type: 'unsupported_claim', section: '二、结构层', detail: '「教育—就业剪刀差是情绪燃料」原为无证据断言，已补标为推断并附推理链条', fixed: true },
    { type: 'overconfident', section: '三、舆论层', detail: 'U 型分布研究自评「中」置信，规则引擎已降级为「低」（会议论文 + 单一来源）', fixed: true },
    { type: 'overconfident', section: '一、行为层', detail: '出生人口 792 万自评「中」，规则引擎已降级为「低」（仅 C 级媒体转述）', fixed: true },
    { type: 'missing_perspective', section: '全文', detail: '初稿缺国际对照视角，已补入第四节（日韩 + 北欧）', fixed: true }
  ]
}

const STATS = {
  sources: srcIdByUrl.size,
  evidences: Object.keys(evIdByKey).length,
  disagreements: DISAGREEMENTS.length,
  aTier: PINNED_SOURCES.filter(s => s.authority_tier === 'A').length,
  searches: 28,
  fetches: 15,
  unresolved: DISAGREEMENTS.filter(d => d.adjudication !== 'adjudicated').length
}

const variants = [
  ['brief', '速览版', BRIEF_MD],
  ['standard', '标准版', STD_MD],
  ['deep', '深度版', DEEP_MD]
]
for (const [variant, label, md] of variants) {
  R(`INSERT INTO reports (project_id,run_id,variant,title,subtitle,md,word_count,stats_json,offline_notice,quality_json,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`, [
    PROJECT_ID, RUN_ID, variant,
    `${TOPIC}：现象、成因与证据基础`,
    `${label} · 三层拆解（舆论/行为/结构）× 7 视角 × ${STATS.evidences} 条证据 × ${STATS.disagreements} 处分歧`,
    md, wc(md), JSON.stringify(STATS), null, JSON.stringify(QUALITY), '2026-10-07 05:43:12'
  ])
}

// ---------- 9. stages + events ----------
for (let i = 0; i < STAGES.length; i++) {
  const s = STAGES[i]
  const id = `${RUN_ID}:${s.key}`
  let outputJson = '{}'
  if (s.key === 'decompose') outputJson = JSON.stringify({ count: SUB_QUESTIONS.length, items: SUB_QUESTIONS.map(x => ({ q: x.question, type: x.qtype, priority: x.priority })) })
  if (s.key === 'perspectives') outputJson = JSON.stringify({ count: PERSPECTIVES.length, items: PERSPECTIVES.map(x => ({ key: x.key, name: x.name })) })
  if (s.key === 'crosscheck') outputJson = JSON.stringify({ conflicts: DISAGREEMENTS.map(d => ({ topic: d.topic, adjudication: d.adjudication })) })
  if (s.key === 'source_eval') outputJson = JSON.stringify({ raw: 143, kept: srcIdByUrl.size, filtered: 58, tiers: { A: 12, B: 1, C: 27, U: 45 } })
  if (s.key === 'audit') outputJson = JSON.stringify(QUALITY)
  R(`INSERT INTO stages (id,run_id,project_id,stage_key,stage_index,title,status,attempt,input_json,output_json,summary,
    tokens_prompt,tokens_completion,llm_calls,searches,fetches,started_at,finished_at,duration_ms)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
    id, RUN_ID, PROJECT_ID, s.key, i, s.title, 'succeeded', 1,
    '{}', outputJson, s.summary,
    8000, 3000, s.llm_calls, s.searches, s.fetches,
    '2026-10-07 05:40:30', '2026-10-07 05:43:10', s.duration_ms
  ])
  R(`INSERT INTO stage_events (run_id,project_id,stage_key,type,payload_json,created_at)
    VALUES (?,?,?,?,?,?)`, [RUN_ID, PROJECT_ID, s.key, 'stage_finish',
    JSON.stringify({ stage: s.key, summary: s.summary }), '2026-10-07 05:4' + (i % 10) + ':00'])
}

console.log('========================================')
console.log('演示报告已入库')
console.log('  projectId :', PROJECT_ID)
console.log('  来源      :', srcIdByUrl.size, `（其中真实检索 ${realCount} 条）`)
console.log('  证据      :', Object.keys(evIdByKey).length)
console.log('  分歧      :', DISAGREEMENTS.length)
console.log('  章节      :', SECTIONS.length)
console.log('  字数      : 速览', wc(BRIEF_MD), '/ 标准', wc(STD_MD), '/ 深度', wc(DEEP_MD))
console.log('========================================')
console.log('打开 http://localhost:5210 即可查看')
