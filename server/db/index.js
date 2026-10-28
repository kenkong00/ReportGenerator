/**
 * 唯一 DB 出口。
 * 隔离 better-sqlite3 与 Node 内置 node:sqlite 的驱动差异，
 * 上层只使用 q / one / run / exec / tx 五个同步方法。
 */
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { DB_PATH } from '../config.js'

const require = createRequire(import.meta.url)

function loadDriver() {
  try {
    const mod = require('better-sqlite3')
    const Database = mod.default || mod
    return { name: 'better-sqlite3', Database, hasTransaction: true }
  } catch (e) {
    // 回退：Node 22 内置 node:sqlite（需 --experimental-sqlite）
    const sqlite = require('node:sqlite')
    if (!sqlite?.DatabaseSync) throw new Error('无可用 SQLite 驱动：' + e.message)
    return { name: 'node:sqlite', Database: sqlite.DatabaseSync, hasTransaction: false }
  }
}

const driver = loadDriver()
const db = new driver.Database(DB_PATH)

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA busy_timeout = 5000;
  PRAGMA synchronous = NORMAL;
  PRAGMA foreign_keys = ON;
`)

/** SQLite 不接受 boolean / undefined，统一归一化 */
function norm(v) {
  if (v === true) return 1
  if (v === false) return 0
  if (v === undefined) return null
  if (v !== null && typeof v === 'object') return JSON.stringify(v)
  return v
}

const stmtCache = new Map()
function stmt(sql) {
  let s = stmtCache.get(sql)
  if (!s) {
    s = db.prepare(sql)
    stmtCache.set(sql, s)
  }
  return s
}

/** 查询多行 */
export function q(sql, ...args) {
  return stmt(sql).all(...args.map(norm))
}

/** 查询单行 */
export function one(sql, ...args) {
  return stmt(sql).get(...args.map(norm))
}

/** 执行写操作，返回 { changes, lastInsertRowid } */
export function run(sql, ...args) {
  const r = stmt(sql).run(...args.map(norm))
  return { changes: r.changes, lastInsertRowid: r.lastInsertRowid }
}

/** 执行多条 SQL（DDL 用） */
export function exec(sql) {
  return db.exec(sql)
}

/** 事务：禁止长事务横跨 LLM 调用 */
export function tx(fn) {
  if (driver.hasTransaction) return db.transaction(fn)()
  exec('BEGIN')
  try {
    const r = fn()
    exec('COMMIT')
    return r
  } catch (e) {
    try { exec('ROLLBACK') } catch {}
    throw e
  }
}

export function applySchema(schemaPath) {
  exec(fs.readFileSync(schemaPath, 'utf8'))
}

export const driverName = driver.name
export const raw = db
export default db
