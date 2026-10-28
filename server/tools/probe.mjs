/**
 * M1 环境探针：把「能不能跑」这件事用实测数据回答，不靠猜。
 * 用法：node server/tools/probe.mjs [sqlite|fts|bing|all]
 */
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)

const NODE = process.execPath
const results = []

function rec(name, ok, detail) {
  results.push({ name, ok, detail })
  console.log(`${ok ? '[PASS]' : '[FAIL]'} ${name}\n       ${detail}\n`)
}

/* ---------- P1 SQLite 驱动 ---------- */
async function p1() {
  let driver = null, Database = null, err = null
  try {
    const m = require('better-sqlite3')
    Database = m.default || m
    driver = 'better-sqlite3'
  } catch (e) {
    err = e.message
  }
  if (!driver) {
    try {
      const s = require('node:sqlite')
      if (s?.DatabaseSync) { Database = s.DatabaseSync; driver = 'node:sqlite' }
    } catch (e2) {
      err += ' | node:sqlite: ' + e2.message
    }
  }
  if (!driver) {
    rec('P1 SQLite 驱动', false, err)
    return null
  }
  try {
    const db = new Database(':memory:')
    db.exec('CREATE TABLE t(a TEXT, b INTEGER)')
    db.prepare('INSERT INTO t VALUES (?,?)').run('x', 1)
    const row = db.prepare('SELECT * FROM t').get()
    const v = driver === 'better-sqlite3' ? require('better-sqlite3/package.json').version : '内置'
    rec('P1 SQLite 驱动', true, `${driver} v${v}；读写通过：${JSON.stringify(row)}；Node ${process.version}`)
    return { driver, Database }
  } catch (e) {
    rec('P1 SQLite 驱动', false, `${driver} 加载成功但读写失败：${e.message}`)
    return null
  }
}

/* ---------- P2 FTS5 trigram 中文检索 ---------- */
async function p2(Drv) {
  if (!Drv) { rec('P2 FTS5 trigram 中文', false, '跳过（无可用驱动）'); return }
  const { Database } = Drv
  try {
    const db = new Database(':memory:')
    db.exec(`CREATE VIRTUAL TABLE f USING fts5(heading, text, tokenize='trigram')`)
    const ins = db.prepare('INSERT INTO f(heading,text) VALUES (?,?)')
    ins.run('电池技术', '比亚迪的刀片电池采用磷酸铁锂路线，体积利用率提升50%以上')
    ins.run('财务数据', '比亚迪2025年第三季度营收达到两千亿元')
    const hit = db.prepare(`SELECT heading, text FROM f WHERE f MATCH ?`).all('"刀片电池"')
    const hit2 = db.prepare(`SELECT heading FROM f WHERE f MATCH ?`).all('"磷酸铁锂"')
    const ok = hit.length >= 1 && hit2.length >= 1
    rec('P2 FTS5 trigram 中文', ok,
      `插入 2 条；搜"刀片电池"命中 ${hit.length} 条，搜"磷酸铁锂"命中 ${hit2.length} 条`)
  } catch (e) {
    rec('P2 FTS5 trigram 中文', false, e.message)
  }
}

/* ---------- P3 Bing RSS 检索 ---------- */
async function p3() {
  const url = 'https://cn.bing.com/search?q=' + encodeURIComponent('比亚迪 刀片电池 技术参数') +
    '&format=rss&count=30&setmkt=zh-CN'
  const t0 = Date.now()
  try {
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), 15000)
    const res = await fetch(url, { signal: ac.signal, headers: { 'User-Agent': UA } })
    clearTimeout(timer)
    const xml = await res.text()
    const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)]
    const first = items[0] ? items[0][1] : ''
    const title = (first.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || ''
    const pub = (first.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1] || '(无)'
    const withDate = items.filter(it => /<pubDate>/.test(it[1])).length
    rec('P3 Bing RSS 检索', items.length >= 5,
      `HTTP ${res.status}，耗时 ${Date.now() - t0}ms；解析到 ${items.length} 条 item，其中 ${withDate} 条带 pubDate；首条标题：${title.slice(0, 40)}；pubDate：${pub}`)
  } catch (e) {
    rec('P3 Bing RSS 检索', false, `耗时 ${Date.now() - t0}ms；${e.message}`)
  }
}

/* ---------- P6 中文源可达性抽样 ---------- */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
async function p6() {
  const targets = [
    ['国家统计局', 'https://www.stats.gov.cn/'],
    ['新浪财经', 'https://finance.sina.com.cn/'],
    ['雪球', 'https://xueqiu.com/'],
    ['Wikipedia 中文', 'https://zh.wikipedia.org/wiki/%E6%AF%94%E4%BA%9A%E8%BF%AA'],
    ['Reuters', 'https://www.reuters.com/']
  ]
  const out = []
  for (const [name, u] of targets) {
    const t0 = Date.now()
    try {
      const ac = new AbortController()
      const timer = setTimeout(() => ac.abort(), 8000)
      const r = await fetch(u, { signal: ac.signal, headers: { 'User-Agent': UA }, redirect: 'follow' })
      clearTimeout(timer)
      out.push(`${name}: ${r.status} (${Date.now() - t0}ms)`)
    } catch (e) {
      out.push(`${name}: 不可达 (${e.message.slice(0, 30)})`)
    }
  }
  console.log('[INFO] 中文/英文源可达性抽样：\n       ' + out.join('\n       ') + '\n')
}

const which = process.argv[2] || 'all'
const Drv = (which === 'all' || which === 'sqlite' || which === 'fts') ? await p1() : null
if (which === 'all' || which === 'fts') await p2(Drv)
if (which === 'all' || which === 'bing') { await p3(); await p6() }

const failed = results.filter(r => !r.ok)
console.log('='.repeat(60))
console.log(`探针结果：${results.length - failed.length}/${results.length} 通过`)
if (failed.length) console.log('未通过：' + failed.map(f => f.name).join('、'))
