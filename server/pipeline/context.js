/**
 * 一次运行的上下文。所有 stage 通过它访问 DB / LLM / 检索 / 预算 / 事件发射。
 */
import * as stagesRepo from '../db/repo/stages.js'
import { createLLM } from '../llm/index.js'
import { SearchHub } from '../search/index.js'
import { Budget } from '../llm/budget.js'
import { BUDGET_PRESETS, relaxWallclockForLocal } from '../config.js'
import { resolveGenre } from '../prompts/_common.js'
import { runLogger } from '../utils/logger.js'
import { EVENT } from './types.js'
import { PauseError } from '../utils/errors.js'

export class RunContext {
  constructor({ project, run, settings, options = {} }) {
    this.project = project
    this.run = run
    this.projectId = project.id
    this.runId = run.id
    this.settings = settings
    this.mode = project.mode || 'standard'
    this.options = { ...(project.options_json ? JSON.parse(project.options_json) : {}), ...options }
    this.logger = runLogger(run.id)
    this.stageKey = null

    const custom = project.budget_json ? JSON.parse(project.budget_json || '{}') : {}
    const hasCustom = Object.keys(custom).length > 0
    const preset = hasCustom
      ? custom
      // 没写死预算的项目：按当前模型是不是本机服务，自动放宽墙钟（本地模型慢得多）
      : relaxWallclockForLocal(BUDGET_PRESETS[this.mode] || BUDGET_PRESETS.standard, {
          provider: settings['llm.provider'],
          baseUrl: settings['llm.compat.baseUrl']
        })
    this.budget = new Budget(preset, this.mode)

    this.llm = createLLM({
      settings,
      runId: run.id,
      projectId: project.id,
      stageKey: null,
      budget: this.budget,
      isPaused: () => this.pauseRequested,
      emit: (type, payload) => this.emit(type, payload)
    })

    this.search = new SearchHub(settings, {
      budget: this.budget,
      emit: (type, payload) => this.emit(type, payload)
    })

    this.aborted = false
    this.pauseRequested = false
    this.abortController = new AbortController()
  }

  /** 是否弱模型模式：本地小模型或速览模式 → 自动压缩每阶段产出规模 */
  get weak() {
    return this.settings?.['llm.weakModel'] === true || this.settings?.['llm.weakModel'] === 'true' || this.mode === 'quick'
  }

  /** 报告风格：professional / casual / playful（默认严肃） */
  get tone() {
    return this.options?.tone || 'professional'
  }

  /**
   * 题材：auto / life / ent / society / biz / tech。
   * 用户在首页可以直接指定；选 auto 时由「拆解」阶段判断出来，之后用 setGenre 固化，
   * 后续所有阶段（视角/来源评估/写作）都跟着换整套纲领。
   */
  get genre() {
    if (this._genre) return this._genre
    return this.project?.genre || 'auto'
  }

  setGenre(g) {
    const v = String(g || '').trim()
    if (v) this._genre = v
  }

  /** 已经确定的题材（auto 时回退到兜底题材），用于取纲领/取信标准 */
  get genreResolved() {
    return resolveGenre(this.genre)
  }

  /** 各阶段的产出上限，集中在这里，方便按模型能力调节 */
  get caps() {
    if (this.weak) {
      return { subQuestions: 6, queriesPerSq: 2, maxQueries: 12, sections: 6, evPerSection: 6, deep: false }
    }
    if (this.mode === 'deep') {
      return { subQuestions: 15, queriesPerSq: 4, maxQueries: 60, sections: 16, evPerSection: 12, deep: true }
    }
    if (this.mode === 'quick') {
      return { subQuestions: 8, queriesPerSq: 3, maxQueries: 16, sections: 8, evPerSection: 8, deep: false }
    }
    return { subQuestions: 12, queriesPerSq: 4, maxQueries: 30, sections: 12, evPerSection: 12, deep: false }
  }

  /** 切换当前阶段（决定 LLM 记账归属与事件归属） */
  enterStage(stageKey) {
    this.stageKey = stageKey
    this.llm.ctx = this.llm.ctx || {}
    // createLLM 闭包里的 ctx 需要同步更新
    this._syncLlmCtx()
  }

  _syncLlmCtx() {
    // llm 内部闭包持有 ctx 引用，这里通过可变对象同步
    if (this.llm._ctxRef) {
      this.llm._ctxRef.stageKey = this.stageKey
      this.llm._ctxRef.emit = (type, payload) => this.emit(type, payload)
    }
  }

  /** 发射事件：落库 + 通知父进程（SSE） */
  emit(type, payload = {}) {
    const seq = stagesRepo.emit({
      runId: this.runId,
      projectId: this.projectId,
      stageKey: this.stageKey,
      type,
      payload
    })
    if (typeof process.send === 'function') {
      try { process.send({ __event: true, seq, type, payload }) } catch {}
    }
    for (const fn of RunContext.listeners) {
      try { fn({ seq, type, payload }) } catch {}
    }
    return seq
  }

  progress(message, current = null, total = null) {
    this.emit(EVENT.STAGE_PROGRESS, { stageKey: this.stageKey, message, current, total })
  }

  chunk(kind, item) {
    this.emit(EVENT.STAGE_CHUNK, { stageKey: this.stageKey, kind, item })
  }

  think(delta) {
    this.emit(EVENT.STAGE_THINK, { stageKey: this.stageKey, delta })
  }

  warnBudget() {
    for (const w of this.budget.warnings()) {
      this.emit(EVENT.BUDGET_WARN, w)
    }
  }

  hitBudget(metric, action) {
    this.emit(EVENT.BUDGET_HIT, {
      metric, used: this.budget.usedOf(metric),
      limit: this.budget.limitOf(metric),
      ratio: Number((this.budget.ratios()[metric] || 0).toFixed(2)),
      action: 'degrade', degrade: action
    })
  }

  abort() {
    this.aborted = true
    this.abortController.abort()
  }

  /** 请求暂停：不打断正在进行的那一步，下一个 LLM 调用前生效 */
  requestPause() {
    this.pauseRequested = true
  }

  clearPause() {
    this.pauseRequested = false
  }

  throwIfPaused() {
    if (this.pauseRequested) throw new PauseError('已在当前步骤前暂停')
  }

  get signal() { return this.abortController.signal }
}

RunContext.listeners = new Set()

export function onEvent(fn) {
  RunContext.listeners.add(fn)
  return () => RunContext.listeners.delete(fn)
}
