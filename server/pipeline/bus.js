/**
 * 父进程侧：管理 pipeline 子进程 + SSE 客户端。
 */
import { fork } from 'node:child_process'
import path from 'node:path'
import { SERVER_DIR } from '../config.js'
import { log, safeErr } from '../utils/logger.js'
import * as stagesRepo from '../db/repo/stages.js'
import * as projRepo from '../db/repo/projects.js'
import { EVENT } from './types.js'

const WORKER = path.join(SERVER_DIR, 'pipeline', 'worker.js')

const children = new Map()     // runId -> ChildProcess
const clients = new Map()      // runId -> Set<res>
const heartbeats = new Map()   // runId -> interval
const lastSeen = new Map()     // runId -> timestamp（看门狗依据）
const watchdog = new Map()     // runId -> interval

let STALL_MS = 180000          // 由 settings 覆盖

export function configureWatchdog({ stallMs }) {
  if (Number(stallMs) > 0) STALL_MS = Number(stallMs)
}

/**
 * 启动（或续跑）一条流水线。
 * 续跑时传入已存在的 runId —— 阶段成果都在同一个 run 下，已成功的会自动跳过。
 */
export function startRun(runId, fromStage = null) {
  if (children.has(runId)) return children.get(runId)

  const args = [runId]
  if (fromStage) args.push(fromStage)
  const child = fork(WORKER, args, {
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    env: { ...process.env }
  })
  children.set(runId, child)
  lastSeen.set(runId, Date.now())
  log(`[bus] 启动 pipeline 子进程 run=${runId} pid=${child.pid}${fromStage ? ' from=' + fromStage : ''}`)

  child.on('message', (msg) => {
    lastSeen.set(runId, Date.now())
    if (msg?.__event) {
      broadcast(runId, { seq: msg.seq, type: msg.type, payload: msg.payload })
    }
  })

  child.on('exit', (code) => {
    children.delete(runId)
    stopHeartbeat(runId)
    stopWatchdog(runId)
    lastSeen.delete(runId)
    if (code !== 0) log(`[bus] 子进程退出码 ${code} run=${runId}`)
    // 兜底：子进程异常退出但 run 仍是 running → 标 failed（这样界面不会一直转圈）
    try {
      const run = projRepo.getRun(runId)
      if (run && run.status === 'running') {
        stagesRepo.resetRunningStages(runId)      // 别让界面上留一个永远在转的阶段
        projRepo.finishRun(runId, 'failed', { error: `子进程异常退出（code ${code}）` })
        projRepo.updateProject(run.project_id, { status: 'failed' })
        broadcast(runId, {
          type: EVENT.RUN_FAILED,
          payload: {
            error: { code: 'worker_exit', message: `子进程异常退出（code ${code}），已完成的部分已保存，可点「继续」续跑` }
          }
        })
      }
    } catch (e) {
      log('[bus] 兜底标记失败：' + safeErr(e))
    }
  })

  child.on('error', (e) => {
    log(`[bus] 子进程错误 run=${runId}：${safeErr(e)}`)
  })

  startHeartbeat(runId)
  startWatchdog(runId)
  return child
}

/** 看门狗：超过 STALL_MS 没有任何动静 → 判定卡死，杀进程并标记，让界面能「继续」 */
function startWatchdog(runId) {
  stopWatchdog(runId)
  const t = setInterval(() => {
    const last = lastSeen.get(runId)
    if (!last) return
    const silent = Date.now() - last
    if (silent < STALL_MS) return
    log(`[bus] run=${runId} 已 ${Math.round(silent / 1000)}s 无动静，判定卡死，强制结束`)
    const child = children.get(runId)
    stopWatchdog(runId)
    try { child?.kill('SIGKILL') } catch {}
    try {
      const run = projRepo.getRun(runId)
      if (run && run.status === 'running') {
        stagesRepo.resetRunningStages(runId)
        projRepo.finishRun(runId, 'failed', { error: `超过 ${Math.round(STALL_MS / 1000)} 秒无进展，已判定中断` })
        projRepo.updateProject(run.project_id, { status: 'failed' })
      }
      broadcast(runId, {
        type: EVENT.RUN_FAILED,
        payload: {
          error: {
            code: 'stalled',
            message: `超过 ${Math.round(STALL_MS / 1000)} 秒没有任何进展（模型服务可能已停止响应）。已完成的部分已保存，点「继续」可接着跑。`
          }
        }
      })
    } catch (e) {
      log('[bus] 看门狗标记失败：' + safeErr(e))
    }
  }, 15000)
  t.unref?.()
  watchdog.set(runId, t)
}

function stopWatchdog(runId) {
  const t = watchdog.get(runId)
  if (t) { clearInterval(t); watchdog.delete(runId) }
}

/**
 * 暂停：温和停止。当前这一步跑完就停，已完成阶段全部保留。
 * 若 15 秒内没停下来（例如卡在模型请求里），强制杀进程并照样标 paused。
 */
export function pauseRun(runId) {
  const child = children.get(runId)
  if (!child) {
    try {
      const run = projRepo.getRun(runId)
      if (run && run.status === 'running') {
        projRepo.updateRun(runId, { status: 'paused', finished_at: new Date().toISOString() })
        projRepo.updateProject(run.project_id, { status: 'paused' })
      }
    } catch {}
    broadcast(runId, { type: EVENT.RUN_PAUSED, payload: { aborted: false } })
    return true
  }
  try { child.send({ type: 'pause' }) } catch {}
  // 兜底：15 秒内没自己停下来（例如卡在模型请求里）就强杀。
  // 注意只认「当初那个子进程」——否则用户点「继续」后，这个定时器会把新进程误杀。
  const killer = setTimeout(() => {
    if (children.get(runId) === child) {
      log(`[bus] 暂停超时，强制结束 run=${runId}`)
      try { children.get(runId)?.kill('SIGKILL') } catch {}
      stagesRepo.resetRunningStages(runId)
      try {
        const run = projRepo.getRun(runId)
        if (run && run.status === 'running') {
          projRepo.updateRun(runId, { status: 'paused', finished_at: new Date().toISOString() })
          projRepo.updateProject(run.project_id, { status: 'paused' })
        }
      } catch {}
      broadcast(runId, { type: EVENT.RUN_PAUSED, payload: { forced: true } })
    }
  }, 15000)
  killer.unref?.()
  return true
}

/** 继续：复用同一个 run，从第一个未成功的阶段接着跑 */
export function resumeRun(runId, fromStage = null) {
  const run = projRepo.getRun(runId)
  if (!run) return false
  if (children.has(runId)) return true
  let from = fromStage
  if (!from) {
    // 找到第一个非 succeeded 的阶段作为续跑起点
    const stages = stagesRepo.listStages(runId)
    const bad = stages.find(s => s.status !== 'succeeded')
    from = bad?.stage_key || null
  }
  projRepo.updateRun(runId, { status: 'running', finished_at: null, last_error: null })
  projRepo.updateProject(run.project_id, { status: 'running' })
  stagesRepo.resetRunningStages(runId)   // 上次中断留下的 running 阶段 → 重跑
  startRun(runId, from)
  return true
}

/** 重跑某个阶段（失败/暂停后用它单独重试）：该阶段及其之后全部重跑，之前的阶段保留 */
export function rerunStage(runId, stageKey) {
  const run = projRepo.getRun(runId)
  if (!run) return false
  if (children.has(runId)) return false
  // 把该阶段及其之后的所有阶段置为待跑（之前的已成功阶段保留，runner 会自动跳过）
  stagesRepo.resetFrom(runId, stageKey)
  projRepo.updateRun(runId, { status: 'running', finished_at: null, last_error: null })
  projRepo.updateProject(run.project_id, { status: 'running' })
  startRun(runId, stageKey)
  return true
}

/**
 * 终止：不再续跑（区别于暂停，状态标记为 aborted，产物保留）。
 * 有子进程就先发 abort 让它自我了断（ctx.abort 会在阶段边界停下并标 aborted）；
 * 3s 内没退出（例如卡在某个网络请求里）就强杀。无在跑子进程则直接标 aborted。
 * 注意：只认「当初那个子进程」，否则用户点「继续」后这个定时器会把新进程误杀。
 */
export function abortRun(runId) {
  const child = children.get(runId)
  if (!child) {
    try {
      const run = projRepo.getRun(runId)
      if (run && run.status !== 'aborted') {
        projRepo.updateRun(runId, { status: 'aborted', finished_at: new Date().toISOString() })
        projRepo.updateProject(run.project_id, { status: 'aborted' })
      }
    } catch {}
    broadcast(runId, { type: EVENT.RUN_ABORTED, payload: { aborted: true } })
    return true
  }
  // 先标 aborted，保证 UI 立刻显示「已中止」，且子进程异常退出时兜底逻辑不会再把它误判为 failed
  try {
    projRepo.updateRun(runId, { status: 'aborted', finished_at: new Date().toISOString() })
    projRepo.updateProject(child && projRepo.getRun(runId)?.project_id, { status: 'aborted' })
  } catch {}
  try { child.send({ type: 'abort' }) } catch {}
  const killer = setTimeout(() => {
    if (children.get(runId) === child) {
      log(`[bus] 终止超时，强制结束 run=${runId}`)
      try { children.get(runId)?.kill('SIGKILL') } catch {}
    }
  }, 3000)
  killer.unref?.()
  broadcast(runId, { type: EVENT.RUN_ABORTED, payload: { aborted: true, graceful: true } })
  return true
}

export function isRunning(runId) {
  return children.has(runId)
}

/* ---------------- SSE ---------------- */

export function subscribe(runId, res, lastSeq = 0) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  })
  res.write(': connected\n\n')

  if (!clients.has(runId)) clients.set(runId, new Set())
  clients.get(runId).add(res)

  // 补发历史事件（Last-Event-ID 续拉）
  if (lastSeq > 0) {
    try {
      const back = stagesRepo.eventsSince(runId, lastSeq, 500)
      for (const e of back) send(res, { seq: e.seq, type: e.type, payload: safeParse(e.payload_json) })
    } catch (e) {
      log('[bus] 补发历史事件失败：' + safeErr(e))
    }
  }

  const ping = setInterval(() => {
    try { res.write(': ping\n\n') } catch { clearInterval(ping) }
  }, 15000)

  const cleanup = () => {
    clearInterval(ping)
    const set = clients.get(runId)
    if (set) { set.delete(res); if (!set.size) clients.delete(runId) }
  }
  res.on('close', cleanup)
  res.on('error', cleanup)

  return cleanup
}

function send(res, { seq, type, payload }) {
  try {
    if (seq) res.write(`id: ${seq}\n`)
    res.write(`event: ${type}\n`)
    res.write(`data: ${JSON.stringify(payload ?? {})}\n\n`)
  } catch {}
}

export function broadcast(runId, { seq, type, payload }) {
  const set = clients.get(runId)
  if (!set?.size) return
  for (const res of set) send(res, { seq, type, payload })
}

function startHeartbeat(runId) {
  stopHeartbeat(runId)
  const t = setInterval(() => {
    broadcast(runId, { type: EVENT.HEARTBEAT, payload: { ts: Date.now() } })
  }, 15000)
  heartbeats.set(runId, t)
}

function stopHeartbeat(runId) {
  const t = heartbeats.get(runId)
  if (t) { clearInterval(t); heartbeats.delete(runId) }
}

function safeParse(v) {
  try { return JSON.parse(v) } catch { return {} }
}

/** 进程启动时清理孤儿 run */
export function cleanupOrphans() {
  try {
    const n = projRepo.markOrphansAborted()
    if (n) log(`[bus] 清理 ${n} 个孤儿 run（上次进程中断遗留）`)
    // 项目状态以 run 为准校正一次：否则界面会一直显示「进行中」
    const m = projRepo.syncAllProjectStatus()
    if (m) log(`[bus] 校正 ${m} 个项目的状态（与最新 run 对齐）`)
    return n
  } catch (e) {
    return 0
  }
}
