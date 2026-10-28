import path from 'node:path'
import fs from 'node:fs'
import { exec, q, one, run } from './index.js'
import * as domainProfiles from './repo/domainProfiles.js'
import * as settings from './repo/settings.js'
import * as prompts from './repo/prompts.js'
import { allSchemaTemplateDefaults } from '../prompts/schemas.js'
import { SERVER_DIR } from '../config.js'

const SCHEMA_PATH = path.join(SERVER_DIR, 'db', 'schema.sql')

/** 给已存在的表补列（CREATE TABLE IF NOT EXISTS 不会改老表结构） */
function ensureColumn(table, column, ddl) {
  try {
    const cols = q(`PRAGMA table_info(${table})`)
    if (!cols.some(c => c.name === column)) {
      exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`)
      return 1
    }
  } catch {}
  return 0
}

export function migrate() {
  const schema = fs.readFileSync(SCHEMA_PATH, 'utf8')
  // 老库第一次跑 schema 时，新索引会引用"还没补上"的新列 → 先吞掉这个错误，
  // 补完列之后再完整跑一次 schema（新库第一次就能全成功）。
  try { exec(schema) } catch {}

  // 增量列迁移（老库升级用）
  const added = [
    ensureColumn('projects', 'genre', "TEXT NOT NULL DEFAULT 'auto'"),
    ensureColumn('sources', 'run_id', 'TEXT'),
    ensureColumn('evidences', 'run_id', 'TEXT')
  ].reduce((a, b) => a + b, 0)

  exec(schema)  // 列齐了，索引一定建得上

  const backfilled = backfillRunIds()
  const idxFixed = fixPerspectiveIndex()

  const n = domainProfiles.seed()
  settings.ensureDefaults()
  // 提示词模板：出厂默认入库（不覆盖用户改动），并播种 schema 结构说明
  const pSeed = prompts.seed()
  const sSeed = prompts.seedSchemas(allSchemaTemplateDefaults())
  const dp = domainProfiles.count()
  return {
    schemaApplied: true, domainProfiles: dp, seededThisRun: n,
    promptTemplates: prompts.count(), promptSeeded: pSeed + sSeed,
    columnsAdded: added, runIdsBackfilled: backfilled, perspectiveIndexFixed: idxFixed
  }
}

/**
 * perspectives 原先有 UNIQUE(project_id, key) —— 第二次运行插入同名视角会冲突，
 * 多版本（run）功能直接被它挡住。旧库需要把索引改成 (project_id, run_id, key)。
 */
function fixPerspectiveIndex() {
  try {
    const cols = q('PRAGMA index_info(idx_persp_key)').map(c => c.name)
    if (cols.length && !cols.includes('run_id')) {
      exec('DROP INDEX IF EXISTS idx_persp_key')
      exec('CREATE UNIQUE INDEX idx_persp_key ON perspectives(project_id, run_id, key)')
      return 1
    }
  } catch {}
  return 0
}

/**
 * 版本隔离迁移：给历史 sources / evidences 回填 run_id。
 * 证据优先按其子问题归属的运行；剩下的（无子问题/无查询来源）归到项目最早的一次运行。
 */
function backfillRunIds() {
  let n = 0
  try {
    n += run(`UPDATE evidences SET run_id = (
                SELECT sq.run_id FROM sub_questions sq WHERE sq.id = evidences.sub_question_id)
              WHERE run_id IS NULL AND sub_question_id IS NOT NULL`).changes || 0
    n += run(`UPDATE sources SET run_id = (
                SELECT q.run_id FROM search_queries q WHERE q.id = sources.from_query_id)
              WHERE run_id IS NULL AND from_query_id IS NOT NULL`).changes || 0
    n += run(`UPDATE evidences SET run_id = (
                SELECT r.id FROM runs r WHERE r.project_id = evidences.project_id ORDER BY r.seq ASC LIMIT 1)
              WHERE run_id IS NULL`).changes || 0
    n += run(`UPDATE sources SET run_id = (
                SELECT r.id FROM runs r WHERE r.project_id = sources.project_id ORDER BY r.seq ASC LIMIT 1)
              WHERE run_id IS NULL`).changes || 0
  } catch (e) {
    // 首次建库时这些表还是空的，忽略
  }
  return n
}

export function status() {
  const tables = one(`SELECT COUNT(*) c FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`)
  return {
    tables: tables?.c || 0,
    domainProfiles: domainProfiles.count(),
    llmProvider: settings.get('llm.provider', 'compat')
  }
}
