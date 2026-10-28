/** 流水线阶段定义与事件常量 */

export const STAGES = [
  { key: 'clarify',      index: 0, title: '澄清锁定问题',   llm: true,  net: false },
  { key: 'decompose',    index: 1, title: '问题拆解',       llm: true,  net: false },
  { key: 'perspectives', index: 2, title: '视角定义',       llm: true,  net: false },
  { key: 'search',       index: 3, title: '广泛检索取证',   llm: true,  net: true  },
  { key: 'source_eval',  index: 4, title: '来源权威评估',   llm: true,  net: false },
  { key: 'extract',      index: 5, title: '证据抽取',       llm: true,  net: true  },
  { key: 'crosscheck',   index: 6, title: '交叉验证与分歧识别', llm: true, net: false },
  { key: 'draft',        index: 7, title: '大纲与逐节写作', llm: true,  net: false },
  { key: 'render',       index: 8, title: '三档报告装配',   llm: true,  net: false },
  { key: 'audit',        index: 9, title: '质量自审',       llm: true,  net: false }
]

export const STAGE_KEYS = STAGES.map(s => s.key)

export function stageInfo(key) {
  return STAGES.find(s => s.key === key) || { key, index: 99, title: key }
}

export const EVENT = {
  RUN_START: 'run.start',
  RUN_DONE: 'run.done',
  RUN_FAILED: 'run.failed',
  RUN_PAUSED: 'run.paused',
  RUN_ABORTED: 'run.aborted',
  STAGE_START: 'stage.start',
  STAGE_PROGRESS: 'stage.progress',
  STAGE_THINK: 'stage.think',
  STAGE_CHUNK: 'stage.chunk',
  STAGE_DONE: 'stage.done',
  STAGE_ERROR: 'stage.error',
  STAGE_RETRY: 'stage.retry',
  STAGE_SKIP: 'stage.skip',
  BUDGET_WARN: 'budget.warn',
  BUDGET_HIT: 'budget.hit',
  HEARTBEAT: 'heartbeat'
}

export const MODE_LABEL = {
  quick: '速览',
  standard: '标准',
  deep: '深度'
}
