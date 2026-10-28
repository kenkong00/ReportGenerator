<template>
  <div class="live">
    <header class="top">
      <div>
        <div class="kicker">调研进行中</div>
        <h1 class="topic">{{ project?.title || '加载中…' }}</h1>
      </div>
      <span class="spacer"></span>
      <div class="row">
        <span v-if="run" class="badge" :class="runBadge">{{ runLabel }}</span>
        <button v-if="isActive" @click="pause">暂停</button>
        <button v-if="isActive" class="danger" @click="abort">终止</button>
        <template v-if="canResume">
          <button class="primary" @click="resume">▶ 继续{{ resumeHint }}</button>
          <button @click="rerunCurrent">↻ 重跑本阶段</button>
        </template>
        <button v-if="hasReport" class="primary" @click="goReport">查看报告</button>
      </div>
    </header>

    <div v-if="banner" class="banner" :class="bannerKind">
      <span class="btitle">{{ banner.title }}</span>
      <span class="btext">{{ banner.text }}</span>
      <span class="spacer"></span>
      <button v-if="canResume" class="primary sm" @click="resume">继续</button>
    </div>

    <div class="grid">
      <!-- 左：阶段时间线 -->
      <aside class="card pad timeline">
        <div class="side-title">调研流水线</div>
        <div
          v-for="s in stageList" :key="s.key"
          class="stage" :class="stageClass(s.key)"
          @click="selectStage(s.key)"
        >
          <div class="dot-wrap">
            <span class="sdot">{{ stageMark(s.key) }}</span>
            <span v-if="s.index < 9" class="line"></span>
          </div>
          <div class="sbody">
            <div class="sname">{{ s.title }}</div>
            <div class="smeta tiny muted">{{ stageMeta(s.key) }}</div>
          </div>
        </div>

        <div class="budget" v-if="usage">
          <div class="side-title">用量</div>
          <div class="brow"><span>检索</span><span class="mono">{{ usage.searches || 0 }}</span></div>
          <div class="brow"><span>LLM 调用</span><span class="mono">{{ usage.llmCalls || 0 }}</span></div>
          <div class="brow"><span>Tokens</span><span class="mono">{{ fmtK(usage.tokens || 0) }}</span></div>
          <div class="brow"><span>耗时</span><span class="mono">{{ fmtDur(elapsed) }}</span></div>
        </div>
      </aside>

      <!-- 右：事件流 -->
      <section class="card pad stream">
        <div class="row stream-head">
          <span class="side-title">实时过程</span>
          <span class="spacer"></span>
          <label class="tiny muted row" style="gap:5px">
            <input type="checkbox" v-model="autoScroll" style="width:auto" /> 自动滚动
          </label>
          <span class="tiny muted">{{ events.length }} 条事件</span>
        </div>

        <div class="events" ref="box">
          <div v-if="!events.length" class="empty small">等待流水线输出…</div>
          <div v-for="(e, i) in events" :key="i" class="ev" :class="'t-' + e.kind">
            <span class="ets mono">{{ e.time }}</span>
            <span class="etag" :class="tagClass(e.type)">{{ shortType(e.type) }}</span>
            <span class="etext">{{ e.text }}</span>
          </div>
          <div v-if="thinking" class="thinking">
            <span class="dots"><i></i><i></i><i></i></span>
            <span class="small muted">模型正在输出…</span>
          </div>
        </div>
      </section>
    </div>

    <!-- 下钻：子问题 → 查询 → 来源 -->
    <section v-if="subQuestions.length" class="card pad drill">
      <div class="side-title">问题拆解（{{ subQuestions.length }}）</div>
      <div class="sq-list">
        <div v-for="sq in subQuestions" :key="sq.id" class="sq">
          <div class="sq-head" @click="toggle(sq.id)">
            <span class="caret">{{ openSq === sq.id ? '▾' : '▸' }}</span>
            <span class="qtype tiny" :class="'q-' + sq.qtype">{{ qtypeLabel(sq.qtype) }}</span>
            <span class="sq-q">{{ sq.question }}</span>
            <span class="spacer"></span>
            <span v-if="sq.answer" class="badge" :class="confBadge(sq.confidence)">{{ confLabel(sq.confidence) }}</span>
            <span v-else class="badge gray">待答</span>
          </div>
          <div v-if="openSq === sq.id" class="sq-body">
            <div class="tiny muted" style="margin-bottom:8px">为什么问这个：{{ sq.rationale || '—' }}</div>
            <div v-if="sq.answer" class="answer small">已答：{{ sq.answer }}</div>
            <div class="qs">
              <div class="tiny muted qtitle">检索词</div>
              <div class="row" style="flex-wrap:wrap;gap:6px">
                <span v-for="q in queriesOf(sq.id)" :key="q.id" class="chip">
                  {{ q.query }}
                  <span class="tiny muted">{{ q.lang }}</span>
                  <span class="tiny" :class="q.status === 'ok' ? 'ok' : 'err'">{{ q.results_count }}</span>
                </span>
                <span v-if="!queriesOf(sq.id).length" class="tiny muted">（尚未检索）</span>
              </div>
            </div>
            <div class="evs">
              <div class="tiny muted qtitle">抽到的证据</div>
              <div v-for="e in evidencesOf(sq.id)" :key="e.id" class="ev-card">
                <div class="row">
                  <span class="badge" :class="tierBadge(e.authority_tier)">{{ e.authority_tier }}</span>
                  <span class="badge" :class="confBadge(e.confidence)">{{ confLabel(e.confidence) }}</span>
                  <span v-if="e.inference" class="badge amber">推断</span>
                  <span class="spacer"></span>
                  <span class="tiny muted ellipsis">{{ e.source_title || e.domain }}</span>
                </div>
                <div class="small claim">{{ e.claim }}</div>
                <div v-if="e.inference && e.inference_chain" class="tiny chain">推理链条：{{ e.inference_chain }}</div>
              </div>
              <div v-if="!evidencesOf(sq.id).length" class="tiny muted">（暂无证据）</div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- 来源清单 -->
    <section v-if="sources.length" class="card pad drill">
      <div class="row"><span class="side-title">来源清单（{{ sources.length }}）</span>
        <span class="spacer"></span>
        <span class="tiny muted">权威等级 A 一手权威 / B 专业二手 / C 需交叉 / U 未知</span>
      </div>
      <div class="src-list">
        <div v-for="s in sources.slice(0, 40)" :key="s.id" class="src-row">
          <span class="badge" :class="tierBadge(s.authority_tier)">{{ s.authority_tier }}</span>
          <a :href="s.url" target="_blank" class="src-title ellipsis">{{ s.title || s.url }}</a>
          <span class="tiny muted nowrap">{{ s.domain }}</span>
          <span class="spacer"></span>
          <span class="tiny muted nowrap">{{ (s.published_at || '').slice(0, 10) }}</span>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { api, subscribeEvents, notify } from '../api'

const route = useRoute()
const router = useRouter()
const id = computed(() => route.params.id)

const project = ref(null)
const run = ref(null)
const events = ref([])
const stages = ref({})
const subQuestions = ref([])
const queries = ref([])
const sources = ref([])
const evidences = ref([])
const usage = ref(null)
const thinking = ref(false)
const autoScroll = ref(true)
const openSq = ref(null)
const box = ref(null)
const elapsed = ref(0)

let unsub = null
let timer = null
let snapshotTimer = null

const STAGE_DEFS = [
  { key: 'clarify', title: '澄清锁定问题' },
  { key: 'decompose', title: '问题拆解' },
  { key: 'perspectives', title: '视角定义' },
  { key: 'search', title: '广泛检索取证' },
  { key: 'source_eval', title: '来源权威评估' },
  { key: 'extract', title: '证据抽取' },
  { key: 'crosscheck', title: '交叉验证与分歧识别' },
  { key: 'draft', title: '大纲与逐节写作' },
  { key: 'render', title: '三档报告装配' },
  { key: 'audit', title: '质量自审' }
]
const stageList = STAGE_DEFS.map((s, i) => ({ ...s, index: i }))

const isActive = computed(() => run.value && ['running', 'pending'].includes(run.value.status))
const hasReport = computed(() => run.value?.status === 'succeeded')
const canResume = computed(() => run.value && ['paused', 'failed', 'aborted'].includes(run.value.status))

/** 续跑起点：第一个没成功的阶段 */
const resumeStage = computed(() => {
  for (const s of stageList) {
    const st = stages.value[s.key]
    if (!st || st.status !== 'succeeded') return s
  }
  return null
})
const resumeHint = computed(() => (resumeStage.value ? `（${resumeStage.value.title}）` : ''))

const banner = computed(() => {
  const st = run.value?.status
  if (st === 'paused') {
    return { kind: 'amber', title: '已暂停', text: '已完成阶段的成果都已保存，点「继续」从断点接着跑，不会从头开始。' }
  }
  if (st === 'failed') {
    return { kind: 'red', title: '中断了', text: (run.value?.last_error || '某一步失败') + '。已收集的内容都在，点「继续」从断点接着跑。' }
  }
  if (st === 'aborted') {
    return { kind: 'gray', title: '已终止', text: '已收集的内容保留着，点「继续」可以接着跑完。' }
  }
  return null
})
const runLabel = computed(() => ({
  running: '进行中', succeeded: '已完成', failed: '失败', aborted: '已中止', paused: '已暂停',
  budget_exceeded: '跑完了但没出报告'
}[run.value?.status] || '准备中'))
const runBadge = computed(() => ({
  running: 'blue', succeeded: 'green', failed: 'red', aborted: 'gray', paused: 'amber',
  budget_exceeded: 'amber'
}[run.value?.status] || 'gray'))

/* ---------------- 加载 ---------------- */
async function loadProject() {
  try {
    const r = await api.get(`/api/projects/${id.value}`)
    project.value = r.project
    run.value = r.run
    for (const s of r.stages || []) stages.value[s.stage_key] = s
    if (r.run && !unsub) attachSSE(r.run.id)
  } catch (e) { /* ignore */ }
}

async function loadSnapshot() {
  try {
    const r = await api.get(`/api/projects/${id.value}/snapshot`)
    subQuestions.value = r.subQuestions || []
    queries.value = r.queries || []
    sources.value = r.sources || []
    evidences.value = r.evidences || []
    if (r.llmUsage) {
      usage.value = {
        searches: (r.stages || []).reduce((n, s) => n + (s.searches || 0), 0),
        llmCalls: r.llmUsage.calls || 0,
        tokens: (r.llmUsage.pt || 0) + (r.llmUsage.ct || 0)
      }
    }
    for (const s of r.stages || []) stages.value[s.stage_key] = s
    if (r.run) run.value = r.run
  } catch {}
}

function attachSSE(runId) {
  unsub = subscribeEvents(runId, onEvent, {
    onError: () => {}
  })
}

/* ---------------- 事件 ---------------- */
function onEvent({ type, payload }) {
  const text = eventText(type, payload)
  if (text) push(type, text)
  if (type === 'stage.start') thinking.value = true
  if (type === 'stage.think') thinking.value = true
  if (type === 'stage.done') {
    thinking.value = false
    stages.value[payload.stageKey] = { ...(stages.value[payload.stageKey] || {}), status: 'succeeded', summary: payload.summary }
    loadSnapshot()
  }
  if (type === 'stage.error') {
    thinking.value = false
    stages.value[payload.stageKey] = { ...(stages.value[payload.stageKey] || {}), status: 'failed', error: payload.error?.message }
  }
  if (type === 'run.done' || type === 'run.failed' || type === 'run.paused' || type === 'run.aborted') {
    thinking.value = false
    // no_report = 跑完了但一份报告都没产出，按「跑完但没出报告」展示，别误导成普通失败
    const st = type === 'run.done' ? 'succeeded'
      : type === 'run.paused' ? 'paused'
      : type === 'run.aborted' ? 'aborted'
      : (payload?.error?.code === 'no_report' ? 'budget_exceeded' : 'failed')
    run.value = { ...(run.value || {}), status: st, last_error: payload?.error?.message || run.value?.last_error }
    loadSnapshot()
    window.dispatchEvent(new Event('project-changed'))
    if (type === 'run.done') setTimeout(goReport, 1200)
  }
  if (type === 'run.start' && payload.stages) {
    for (const s of payload.stages) stages.value[s.key] = { ...(stages.value[s.key] || {}), stage_key: s.key, status: 'pending' }
  }
}

const MAX = 400
function push(type, text) {
  events.value.push({
    type, text,
    time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
    kind: kindOf(type)
  })
  if (events.value.length > MAX) events.value.splice(0, events.value.length - MAX)
  if (autoScroll.value) nextTick(() => { if (box.value) box.value.scrollTop = box.value.scrollHeight })
}

function eventText(type, p = {}) {
  switch (type) {
    case 'run.start': return `流水线启动（${p.mode || ''}），共 ${p.stages?.length || 10} 个阶段`
    case 'stage.start': return `▸ 开始：${stageTitle(p.stageKey)}`
    case 'stage.progress': return p.current != null ? `${p.message}（${p.current}/${p.total}）` : p.message
    case 'stage.done': return `✓ ${stageTitle(p.stageKey)}：${p.summary}`
    case 'stage.error': return `✗ ${stageTitle(p.stageKey)} 失败：${p.error?.message || '未知错误'}`
    case 'stage.retry': return `↻ 重试 ${stageTitle(p.stageKey)}（第 ${p.attempt} 次）：${p.reason}`
    case 'stage.skip': return `↷ 跳过 ${stageTitle(p.stageKey)}（已完成）`
    case 'stage.chunk': return chunkText(p)
    case 'budget.warn': return `⚠ 预算告警：${p.metric} 已用 ${Math.round((p.ratio || 0) * 100)}%`
    case 'budget.hit': return `⚠ 预算触顶：${p.metric}，执行降级`
    case 'run.done': return `✓ 全部完成，耗时 ${Math.round((p.durationMs || 0) / 1000)} 秒`
    case 'run.failed': return `✗ 失败：${p.error?.message || ''}`
    case 'run.paused': return `⏸ 已暂停（${stageTitle(p.stageKey)}）：成果已保存，可继续`
    case 'run.aborted': return `■ 已中止（${stageTitle(p.stageKey)}）：已保存的内容都在，点「继续」从断点接着跑`
    default: return null
  }
}

function chunkText(p) {
  const it = p.item || {}
  const map = {
    genre: `题材判定：${it.label || it.genre}`,
    subQuestion: `拆解出子问题：${it.question || ''}`,
    perspective: `定义视角：${it.name || ''} — ${it.lens || ''}`,
    query: `检索词：${it.query || ''}（${it.lang}）`,
    source: `找到来源：${(it.title || '').slice(0, 40)} · ${it.domain}`,
    sourceEval: `来源评估：${it.domain} → ${it.tier}`,
    evidence: `抽取证据：${(it.claim || '').slice(0, 50)}（${it.tier}/${it.confidence}）`,
    disagreement: `发现分歧：${it.topic}`,
    section: `完成章节：${it.heading}（引用 ${it.refs} 条证据）`,
    sectionError: `章节失败：${it.heading} — ${it.error}`,
    auditIssue: `自审发现 ${it.count} 处问题：${it.heading}`
  }
  return map[p.kind] || null
}

function kindOf(type) {
  if (type.startsWith('stage.error') || type === 'run.failed') return 'err'
  if (type === 'stage.done' || type === 'run.done') return 'ok'
  if (type.startsWith('budget') || type === 'stage.retry') return 'warn'
  return 'info'
}

function shortType(t) {
  const m = {
    'run.start': '启动', 'run.done': '完成', 'run.failed': '失败', 'run.paused': '暂停', 'run.aborted': '中止',
    'stage.start': '阶段', 'stage.progress': '进度', 'stage.done': '完成', 'stage.error': '错误',
    'stage.retry': '重试', 'stage.skip': '跳过', 'stage.chunk': '产出',
    'budget.warn': '预算', 'budget.hit': '预算', 'stage.think': '思考'
  }
  return m[t] || t.replace('stage.', '').replace('run.', '')
}

function tagClass(t) {
  if (t === 'run.aborted') return 'gray'
  if (t.endsWith('.error') || t === 'run.failed') return 'red'
  if (t.endsWith('.done') || t === 'run.done') return 'green'
  if (t.startsWith('budget')) return 'amber'
  if (t === 'stage.chunk') return 'blue'
  return 'gray'
}

/* ---------------- 渲染辅助 ---------------- */
function stageTitle(k) { return STAGE_DEFS.find(s => s.key === k)?.title || k }
function stageClass(k) {
  const s = stages.value[k]
  if (!s) return ''
  return { succeeded: 'done', succeeded_with_warnings: 'done', running: 'run', failed: 'err', skipped: 'skip' }[s.status] || ''
}
function stageMark(k) {
  const s = stages.value[k]
  if (!s) return '·'
  return { succeeded: '✓', succeeded_with_warnings: '✓', running: '◐', failed: '✗', skipped: '↷' }[s.status] || '·'
}
function stageMeta(k) {
  const s = stages.value[k]
  if (!s) return ''
  if (s.summary) return s.summary.slice(0, 26)
  if (s.error) return String(s.error).slice(0, 26)
  return ''
}

function queriesOf(sqId) { return queries.value.filter(q => q.sub_question_id === sqId) }
function evidencesOf(sqId) { return evidences.value.filter(e => e.sub_question_id === sqId) }
function toggle(sqId) { openSq.value = openSq.value === sqId ? null : sqId }

function tierBadge(t) { return { A: 'green', B: 'blue', C: 'amber', D: 'red', U: 'gray' }[t] || 'gray' }
function confBadge(c) { return { high: 'green', medium: 'blue', low: 'amber', disputed: 'red' }[c] || 'gray' }
function confLabel(c) { return { high: '高置信', medium: '中置信', low: '低置信', disputed: '存疑' }[c] || c }
function qtypeLabel(t) {
  return { factual: '事实', numeric: '数据', opinion: '观点', forecast: '预测', causal: '因果' }[t] || t
}

function fmtK(n) { return n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n) }
function fmtDur(ms) {
  const s = Math.round(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

async function pause() {
  try {
    await api.post(`/api/runs/${run.value.id}/pause`, {})
    run.value = { ...run.value, status: 'paused' }
    notify('已请求暂停：当前这一步跑完就停', 'ok')
  } catch (e) { notify('暂停失败：' + e.message, 'err') }
}

async function resume() {
  try {
    await api.post(`/api/runs/${run.value.id}/resume`, {})
    run.value = { ...run.value, status: 'running' }
    notify('已继续：从断点接着跑', 'ok')
    setTimeout(loadProject, 800)
  } catch (e) { notify('继续失败：' + e.message, 'err') }
}

async function rerunCurrent() {
  const key = resumeStage.value?.key
  if (!key) return notify('没有可重跑的阶段', 'err')
  try {
    await api.post(`/api/runs/${run.value.id}/rerun`, { stage: key })
    run.value = { ...run.value, status: 'running' }
    notify(`已重跑「${resumeStage.value.title}」`, 'ok')
    setTimeout(loadProject, 800)
  } catch (e) { notify('重跑失败：' + e.message, 'err') }
}

async function abort() {
  if (!confirm('终止这次调研？已收集的内容会保留，之后仍可点「继续」。')) return
  await api.post(`/api/projects/${id.value}/abort`, {})
  run.value = { ...(run.value || {}), status: 'aborted' }
}

function goReport() { router.push(`/report/${id.value}`) }
function selectStage() {}

/* ---------------- 生命周期 ---------------- */
onMounted(async () => {
  await loadProject()
  await loadSnapshot()
  snapshotTimer = setInterval(loadSnapshot, 8000)
  timer = setInterval(() => { elapsed.value += 1000 }, 1000)
})

onUnmounted(() => {
  unsub?.()
  clearInterval(timer)
  clearInterval(snapshotTimer)
})
</script>

<style scoped>
.live { max-width: 1240px; margin: 0 auto; padding: 26px 24px 60px; display: flex; flex-direction: column; gap: 16px; }
.top { display: flex; align-items: flex-start; gap: 14px; }
.kicker { font-size: 11px; font-weight: 700; letter-spacing: .08em; color: var(--primary); }
.topic { font-size: 22px; margin: 2px 0 0; }

.banner { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-radius: 8px; font-size: 13px; }
.banner .btitle { font-weight: 700; flex: 0 0 auto; }
.banner .btext { color: var(--text-2); }
.banner.amber { background: var(--warn-bg); border: 1px solid #fcd34d; }
.banner.amber .btitle { color: var(--warn); }
.banner.red { background: var(--danger-bg); border: 1px solid #fca5a5; }
.banner.red .btitle { color: var(--danger); }
.banner.gray { background: var(--panel-2); border: 1px solid var(--border); }
.banner .sm { padding: 3px 12px; font-size: 12px; }

.grid { display: grid; grid-template-columns: 300px 1fr; gap: 16px; }

.side-title { font-size: 11px; font-weight: 700; color: var(--text-3); letter-spacing: .05em; margin-bottom: 10px; }

.timeline { align-self: start; }
.stage { display: flex; gap: 10px; cursor: pointer; }
.dot-wrap { display: flex; flex-direction: column; align-items: center; width: 18px; flex: 0 0 18px; }
.sdot { width: 18px; height: 18px; border-radius: 50%; background: #eef0f3; color: var(--text-3);
  font-size: 11px; display: flex; align-items: center; justify-content: center; font-weight: 700; }
.line { flex: 1; width: 2px; background: var(--border); margin: 3px 0; min-height: 12px; }
.sbody { padding-bottom: 14px; flex: 1; min-width: 0; }
.sname { font-size: 13px; color: var(--text-2); }
.smeta { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.stage.done .sdot { background: var(--ok-bg); color: var(--ok); }
.stage.done .sname { color: var(--text); font-weight: 600; }
.stage.run .sdot { background: var(--primary); color: #fff; animation: pulse 1.4s infinite; }
.stage.run .sname { color: var(--primary); font-weight: 700; }
.stage.err .sdot { background: var(--danger-bg); color: var(--danger); }
.stage.err .sname { color: var(--danger); }
.stage.skip .sdot { background: #f1f3f5; color: var(--text-3); }
@keyframes pulse { 0%,100% { opacity: 1 } 50% { opacity: .5 } }

.budget { border-top: 1px solid var(--border); margin-top: 6px; padding-top: 12px; }
.brow { display: flex; justify-content: space-between; font-size: 12px; color: var(--text-2); padding: 3px 0; }

.stream { display: flex; flex-direction: column; min-height: 420px; }
.stream-head { margin-bottom: 10px; }
.events { flex: 1; overflow-y: auto; max-height: 460px; font-size: 12.5px; }
.ev { display: flex; gap: 8px; padding: 3px 0; align-items: baseline; }
.ets { color: var(--text-3); font-size: 11px; flex: 0 0 60px; }
.etag { font-size: 10px; padding: 0 5px; border-radius: 3px; font-weight: 700; flex: 0 0 auto; }
.etag.gray { background: #f1f3f5; color: #6b7280; }
.etag.green { background: var(--ok-bg); color: var(--ok); }
.etag.red { background: var(--danger-bg); color: var(--danger); }
.etag.amber { background: var(--warn-bg); color: var(--warn); }
.etag.blue { background: var(--primary-soft); color: var(--primary); }
.etext { flex: 1; color: var(--text); word-break: break-word; }
.ev.t-err .etext { color: var(--danger); }
.ev.t-ok .etext { color: var(--ok); }
.ev.t-warn .etext { color: var(--warn); }

.thinking { display: flex; align-items: center; gap: 8px; padding: 6px 0; }
.dots { display: inline-flex; gap: 3px; }
.dots i { width: 5px; height: 5px; border-radius: 50%; background: var(--primary); animation: bounce 1s infinite; }
.dots i:nth-child(2) { animation-delay: .15s }
.dots i:nth-child(3) { animation-delay: .3s }
@keyframes bounce { 0%,100% { opacity: .3 } 50% { opacity: 1 } }

.sq-list { display: flex; flex-direction: column; }
.sq { border-bottom: 1px solid var(--border); }
.sq:last-child { border-bottom: none; }
.sq-head { display: flex; align-items: center; gap: 8px; padding: 9px 0; cursor: pointer; }
.sq-head:hover { background: var(--panel-2); }
.caret { width: 12px; color: var(--text-3); font-size: 10px; }
.sq-q { font-size: 13.5px; flex: 1; min-width: 0; }
.qtype { padding: 1px 6px; border-radius: 3px; background: #f1f3f5; color: #4b5563; font-weight: 700; }
.q-numeric { background: #e0f2fe; color: #075985; }
.q-opinion { background: #fae8ff; color: #86198f; }
.q-causal { background: #dcfce7; color: #166534; }
.q-forecast { background: #fef3c7; color: #92400e; }

.sq-body { padding: 4px 0 14px 20px; }
.answer { background: var(--panel-2); border-left: 3px solid var(--primary); padding: 8px 12px; border-radius: 0 6px 6px 0; margin-bottom: 10px; }
.qtitle { margin: 10px 0 5px; font-weight: 700; }
.chip { display: inline-flex; align-items: center; gap: 4px; background: var(--panel-2);
  border: 1px solid var(--border); border-radius: 20px; padding: 2px 10px; font-size: 12px; }
.chip .ok { color: var(--ok); font-weight: 700; }
.chip .err { color: var(--danger); font-weight: 700; }

.ev-card { border: 1px solid var(--border); border-radius: 8px; padding: 9px 12px; margin-bottom: 7px; background: var(--panel-2); }
.claim { margin-top: 6px; }
.chain { color: var(--warn); margin-top: 5px; }

.src-list { display: flex; flex-direction: column; }
.src-row { display: flex; align-items: center; gap: 8px; padding: 6px 0; border-bottom: 1px solid #f1f3f5; font-size: 12.5px; }
.src-title { flex: 1; min-width: 0; font-size: 13px; color: var(--text); }

@media (max-width: 980px) {
  .grid { grid-template-columns: 1fr; }
}
</style>
