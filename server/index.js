import express from 'express'
import path from 'node:path'
import fs from 'node:fs'
import http from 'node:http'
import { PORT, DIST_DIR, DATA_DIR } from './config.js'
import { migrate } from './db/migrate.js'
import * as bus from './pipeline/bus.js'
import { log } from './utils/logger.js'
import { exec, one } from './db/index.js'

// 建库
migrate()

const app = express()
app.use(express.json({ limit: '4mb' }))
app.use(express.urlencoded({ extended: true }))

/* ---------------- API ---------------- */
app.get('/api/health', (req, res) => {
  const tables = one("SELECT COUNT(*) c FROM sqlite_master WHERE type='table'")
  res.json({ ok: true, ts: Date.now(), port: PORT, tables: tables?.c || 0 })
})

app.use('/api/projects', (await import('./routes/projects.js')).default)
app.use('/api/runs', (await import('./routes/runs.js')).default)
app.use('/api/reports', (await import('./routes/reports.js')).default)
app.use('/api/settings', (await import('./routes/settings.js')).default)
app.use('/api/knowledge', (await import('./routes/knowledge.js')).default)
app.use('/api/prompts', (await import('./routes/prompts.js')).default)

/** 调研过程的完整快照（前端 Live 页下钻用） */
app.get('/api/projects/:id/snapshot', async (req, res) => {
  try {
    const projRepo = await import('./db/repo/projects.js')
    const rRepo = await import('./db/repo/research.js')
    const stagesRepo = await import('./db/repo/stages.js')
    const p = projRepo.getProject(req.params.id)
    if (!p) return res.status(404).json({ ok: false, error: '项目不存在' })
    const run = projRepo.latestRun(p.id)
    if (!run) return res.json({ ok: true, project: p, run: null })

    res.json({
      ok: true,
      project: p,
      run,
      stages: stagesRepo.listStages(run.id),
      subQuestions: rRepo.listSubQuestions(p.id, run.id),
      perspectives: rRepo.listPerspectives(p.id, run.id),
      queries: rRepo.listQueries(p.id, run.id),
      sources: rRepo.listSourcesForRun(p.id, run.id),
      evidences: rRepo.listEvidences(p.id, run.id),
      disagreements: rRepo.listDisagreements(p.id, run.id),
      llmUsage: stagesRepo.llmUsageOfRun(run.id)
    })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

/* ---------------- 静态资源 ---------------- */
if (fs.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR))
  app.get(/^(?!\/api).*/, (req, res) => {
    res.sendFile(path.join(DIST_DIR, 'index.html'))
  })
} else {
  app.get('/', (req, res) => {
    res.type('html').send(`<h1>深度调研报告生成器</h1>
<p>前端尚未构建。请运行 <code>npm run build</code> 后刷新，或用 <code>npm run dev</code> 启动 Vite 开发服务器（端口 5209）。</p>
<p><a href="/api/health">/api/health</a></p>`)
  })
}

/* ---------------- 启动 ---------------- */
bus.cleanupOrphans()
try {
  const settingsRepo = await import('./db/repo/settings.js')
  bus.configureWatchdog({ stallMs: settingsRepo.get('pipeline.stallMs') })
  log(`看门狗：超过 ${Math.round((Number(settingsRepo.get('pipeline.stallMs')) || 180000) / 1000)} 秒无进展即判定中断`)
  // 检索层代理：mode=on/auto 时启用（某些网络下国内站点需要代理才能访问）
  const httpMod = await import('./search/http.js')
  const mode = settingsRepo.get('proxy.mode', 'off')
  const purl = settingsRepo.get('proxy.url', '')
  if ((mode === 'on' || mode === 'auto') && purl) {
    const ok = httpMod.setProxy(purl)
    log(`检索代理：${ok ? '已启用 ' + purl : '启用失败（检查地址）'}`)
  } else {
    log('检索代理：未启用（直连）')
  }
} catch (e) {
  log('启动配置失败：' + e.message)
}

const server = http.createServer(app)
server.listen(PORT, () => {
  log(`深度调研报告生成器 · 后端已启动：http://localhost:${PORT}`)
  log(`数据库：${path.join(DATA_DIR, 'research.db')}`)
  if (!fs.existsSync(DIST_DIR)) log('提示：前端未构建，访问 5209（Vite dev）查看界面')
})

// SSE 长连接不受 keep-alive 超时影响
server.keepAliveTimeout = 0
server.headersTimeout = 0

process.on('SIGINT', () => { log('收到 SIGINT，退出'); process.exit(0) })
process.on('unhandledRejection', (e) => log(`[unhandledRejection] ${e?.message || e}`))
