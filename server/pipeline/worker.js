#!/usr/bin/env node
/**
 * Pipeline 子进程入口。
 * 用 child_process.fork 启动：Node 崩了不拖垮 Express，SSE 断线也不误伤任务。
 * 用法：node server/pipeline/worker.js <runId> [fromStage]
 */
import { RunContext } from './context.js'
import { runPipeline } from './runner.js'
import * as projRepo from '../db/repo/projects.js'
import * as settingsRepo from '../db/repo/settings.js'
import * as stagesRepo from '../db/repo/stages.js'
import { log, safeErr } from '../utils/logger.js'

const runId = process.argv[2]
const fromStage = process.argv[3] || null

async function main() {
  if (!runId) {
    console.error('缺少 runId')
    process.exit(1)
  }
  const run = projRepo.getRun(runId)
  if (!run) {
    console.error('run 不存在：' + runId)
    process.exit(1)
  }
  const project = projRepo.getProject(run.project_id)
  if (!project) {
    console.error('project 不存在：' + run.project_id)
    process.exit(1)
  }

  const settings = settingsRepo.getAll()
  const ctx = new RunContext({ project, run, settings })

  process.on('message', (msg) => {
    if (msg?.type === 'abort') {
      log(`[worker ${runId}] 收到中止信号`)
      ctx.abort()
    } else if (msg?.type === 'pause') {
      log(`[worker ${runId}] 收到暂停信号：当前这一步跑完后停下`)
      ctx.requestPause()
    }
  })

  // 心跳：父进程靠它判断「是不是卡死了」（默认 10s 一跳）
  const ping = setInterval(() => {
    try { process.send?.({ __ping: true, ts: Date.now(), stage: ctx.stageKey }) } catch {}
  }, 10000)

  // 父进程断开（被强杀 / 服务重启）→ 立刻收尾，不留 running 僵尸
  process.on('disconnect', () => {
    log(`[worker ${runId}] IPC 断开，主动退出`)
    ctx.abort()
    clearInterval(ping)
  })

  try {
    const r = await runPipeline(ctx, { fromStage })
    clearInterval(ping)
    process.exit(r.ok ? 0 : 1)
  } catch (e) {
    clearInterval(ping)
    log(`[worker ${runId}] 未捕获异常：${safeErr(e)}`)
    stagesRepo.emit({ runId, projectId: project.id, type: 'run.failed', payload: { error: { code: 'crash', message: safeErr(e) } } })
    projRepo.finishRun(runId, 'failed', { error: safeErr(e) })
    projRepo.updateProject(project.id, { status: 'failed' })
    process.exit(1)
  }
}

main()
