<template>
  <div class="report" v-if="loaded">
    <header class="top">
      <div class="head-main">
        <div class="kicker">{{ modeLabel(project.mode) }}调研报告<template v-if="genreLabel(project.genre)"> · {{ genreLabel(project.genre) }}</template></div>
        <h1>{{ report?.title || project.title }}</h1>
        <div class="row meta-row">
          <span class="tiny muted">生成于 {{ fmt(report?.created_at) }}</span>
          <span class="tiny muted">· {{ report?.word_count || 0 }} 字</span>
          <span class="tiny muted">· {{ sources.length }} 个来源</span>
          <span class="tiny muted">· {{ evidences.length }} 条证据</span>
          <span v-if="disagreements.length" class="tiny muted">· {{ disagreements.length }} 处分歧</span>
        </div>
      </div>
      <span class="spacer"></span>
      <div class="row">
        <button @click="showProcess = !showProcess">{{ showProcess ? '收起' : '查看' }}调研过程</button>
        <button @click="exportAs('md')">导出 MD</button>
        <button @click="exportAs('html')">导出 HTML</button>
        <button @click="exportAs('doc')">导出 Word</button>
        <button class="primary" @click="printPdf">打印 / 存 PDF</button>
      </div>
    </header>

    <!-- 版本条：同一主题可跑多版，可切换、可新增、可删除 -->
    <div class="vbar">
      <span class="vlabel">版本</span>
      <div class="vchips">
        <button
          v-for="v in versions" :key="v.runId"
          class="vchip" :class="{ on: v.runId === activeRunId, running: v.status === 'running' }"
          :title="`v${v.seq} · ${vstatus(v.status)} · ${fmt(v.startedAt)}`"
          @click="switchVersion(v.runId)"
        >
          v{{ v.seq }}
          <span v-if="v.isCurrent" class="dot" title="当前版本"></span>
        </button>
      </div>
      <button class="vchip add" @click="openNewVersion">＋ 生成新版本</button>

      <span class="spacer"></span>

      <span v-if="activeVersion" class="tiny muted">
        {{ fmt(activeVersion.startedAt) }} · {{ activeVersion.wordCount || 0 }} 字 · {{ activeVersion.evidenceCount }} 条证据
      </span>
      <button
        v-if="versions.length > 1"
        class="sm ghost danger"
        :disabled="activeVersion?.status === 'running'"
        @click="removeVersion"
      >删除此版本</button>
    </div>

    <!-- 新版本参数 -->
    <div v-if="showNew" class="newver">
      <div class="nv-row">
        <label class="fv"><span>深度</span>
          <select v-model="nv.mode">
            <option value="quick">快看</option>
            <option value="standard">标准</option>
            <option value="deep">深研</option>
          </select>
        </label>
        <label class="fv"><span>题材</span>
          <select v-model="nv.genre">
            <option value="auto">自动</option>
            <option value="life">生活日常</option>
            <option value="ent">娱乐文化</option>
            <option value="society">社会公共</option>
            <option value="biz">商业财经</option>
            <option value="tech">科技知识</option>
          </select>
        </label>
        <label class="fv"><span>风格</span>
          <select v-model="nv.tone">
            <option value="professional">严肃</option>
            <option value="casual">轻松</option>
            <option value="playful">搞怪</option>
          </select>
        </label>
        <span class="spacer"></span>
        <button class="primary" :disabled="creating" @click="createVersion">
          {{ creating ? '正在启动…' : '开始生成新版本' }}
        </button>
        <button class="ghost" @click="showNew = false">取消</button>
      </div>
      <p class="tiny muted nv-tip">
        同一个主题会<b>重新拆解、重新检索、重新成文</b>，产出与已有版本互不干扰的一份新报告。
        旧版本会一直保留，随时可以在上面切换查看或删除。
      </p>
    </div>

    <!-- 离线警示 -->
    <div v-if="report?.offline_notice" class="offline">
      ⚠️ {{ report.offline_notice }}
    </div>

    <!-- 该版本尚无报告 -->
    <div v-if="!report" class="card pad nover">
      <p class="nover-t"><b>这个版本还没有产出报告。</b></p>
      <p class="small muted">
        当前状态：{{ vstatus(activeVersion?.status) }}
        <template v-if="activeVersion?.lastError"> · {{ activeVersion.lastError }}</template>
      </p>
      <p v-if="canFinalize" class="small muted nover-tip">
        如果前面的阶段（拆题 / 检索 / 提取 / 写作）已经跑完，通常只是「装配」和「自审」没执行。
        点下面的按钮<b>直接成稿</b>——已收集的章节和证据都还在，不用重新检索。
      </p>
      <div class="row" style="margin-top:12px">
        <button v-if="canFinalize" class="primary" :disabled="finalizing" @click="finalizeVersion">
          {{ finalizing ? '正在装配…' : '补跑装配（装配 + 自审）' }}
        </button>
        <button @click="router.push(`/live/${id}`)">查看它的运行过程</button>
        <button @click="openNewVersion">生成一个新版本</button>
      </div>
    </div>

    <template v-if="report">
    <!-- 三档切换 -->
    <div class="tabs">
      <button
        v-for="v in variants" :key="v.key"
        class="tab" :class="{ on: variant === v.key }"
        :disabled="!available.includes(v.key)"
        @click="switchVariant(v.key)"
      >
        {{ v.label }}
        <span class="tiny muted">{{ v.desc }}</span>
      </button>
      <span class="spacer"></span>
      <div v-if="quality.issueCount" class="row">
        <span class="badge amber">自审 {{ quality.issueCount }} 处提示</span>
      </div>
    </div>

    <div class="body-grid" :class="{ 'with-panel': activeEvidence }">
      <!-- 正文 -->
      <article class="card pad doc">
        <Markdown :content="report?.md || ''" :evidences="evidences" @evidence="openEvidence" />

        <!-- 分歧地图 -->
        <section v-if="disagreements.length" class="dis">
          <h2>分歧地图</h2>
          <p class="small muted">这些地方，不同来源说法不一致。系统不会替你和稀泥——能裁决的给裁决，不能裁决的明确标为"未裁决"。</p>
          <div v-for="(d, i) in disagreements" :key="d.id" class="dis-card">
            <div class="row dis-head">
              <span class="dis-idx">{{ i + 1 }}</span>
              <span class="dis-topic">{{ d.topic }}</span>
              <span class="spacer"></span>
              <span class="badge" :class="adjBadge(d.adjudication)">{{ adjLabel(d.adjudication) }}</span>
              <span class="badge" :class="sevBadge(d.severity)">{{ sevLabel(d.severity) }}</span>
            </div>
            <div class="positions">
              <div v-for="(p, j) in d.positions || []" :key="j" class="pos">
                <span class="pos-stance">{{ p.stance }}</span>
                <span class="pos-claim">{{ p.claim }}</span>
              </div>
            </div>
            <div class="tiny muted root">为什么会不一样：{{ d.root_cause || '未判定' }}</div>
            <div v-if="d.verdict" class="verdict small">本报告采用口径：{{ d.verdict }}</div>
          </div>
        </section>

        <!-- 来源清单 -->
        <section class="srcs">
          <h2>来源清单</h2>
          <div class="row src-filter">
            <span class="tiny muted">按权威等级排序：A 一手权威 · B 专业二手 · C 需交叉验证 · U 未知</span>
            <span class="spacer"></span>
            <button class="sm ghost" @click="srcLimit = srcLimit > 20 ? 20 : 200">
              {{ srcLimit > 20 ? '收起' : `展开全部 ${sources.length} 条` }}
            </button>
          </div>
          <div v-for="s in sortedSources.slice(0, srcLimit)" :key="s.id" class="src-row">
            <span class="badge" :class="tierBadge(s.authority_tier)">{{ s.authority_tier }}</span>
            <a :href="s.url" target="_blank" class="src-title">{{ s.title || s.url }}</a>
            <span class="tiny muted">{{ s.domain }}</span>
            <span class="spacer"></span>
            <span v-if="s.quality_score" class="tiny muted mono">{{ (s.quality_score * 100).toFixed(0) }}分</span>
            <span class="tiny muted">{{ (s.published_at || '').slice(0, 10) }}</span>
          </div>
        </section>
      </article>

      <!-- 证据侧栏 -->
      <aside v-if="activeEvidence" class="card pad ev-panel">
        <div class="row">
          <span class="side-title">证据详情</span>
          <span class="spacer"></span>
          <button class="ghost sm" @click="activeEvidence = null">✕</button>
        </div>
        <div class="row ev-badges">
          <span class="badge" :class="tierBadge(activeEvidence.authority_tier)">{{ activeEvidence.authority_tier }} 级来源</span>
          <span class="badge" :class="confBadge(activeEvidence.confidence)">{{ confLabel(activeEvidence.confidence) }}</span>
          <span v-if="activeEvidence.inference" class="badge amber">这是推断</span>
        </div>

        <div class="ev-claim">{{ activeEvidence.claim }}</div>

        <div class="ev-block">
          <div class="ev-label">原文摘录</div>
          <blockquote class="ev-quote">{{ activeEvidence.quote }}</blockquote>
        </div>

        <div class="ev-block">
          <div class="ev-label">来源</div>
          <a :href="activeEvidence.source_url" target="_blank" class="ev-src">{{ activeEvidence.source_title || activeEvidence.domain }}</a>
          <div class="tiny muted ellipsis">{{ activeEvidence.source_url }}</div>
        </div>

        <div v-if="dataPoints.length" class="ev-block">
          <div class="ev-label">数据点</div>
          <div v-for="(d, i) in dataPoints" :key="i" class="dp">
            <span>{{ d.label }}</span>
            <span class="mono">{{ d.value }}{{ d.unit || '' }}</span>
            <span class="tiny muted">{{ d.asOf || '' }}</span>
          </div>
        </div>

        <div v-if="activeEvidence.inference" class="ev-block infer">
          <div class="ev-label">推理链条</div>
          <div class="small">{{ activeEvidence.inference_chain || '未记录' }}</div>
        </div>

        <div class="ev-block">
          <div class="ev-label">置信度判定依据</div>
          <div class="small muted">{{ activeEvidence.confidence_reason || '—' }}</div>
          <div v-if="activeEvidence.confidence_llm && activeEvidence.confidence_llm !== activeEvidence.confidence" class="tiny warn-note">
            模型自评 {{ confLabel(activeEvidence.confidence_llm) }}，规则判定 {{ confLabel(activeEvidence.confidence) }}，已取更保守值
          </div>
        </div>
      </aside>
    </div>

    <!-- 调研过程 -->
    <section v-if="showProcess" class="card pad process">
      <div class="row"><h2 style="margin:0">调研过程</h2>
        <span class="spacer"></span>
        <span class="tiny muted">每一步的原始输入输出都在这里，你可以核对结论是怎么来的</span>
      </div>
      <div class="stages">
        <div v-for="s in stages" :key="s.id" class="stage-row">
          <div class="row">
            <span class="smark">{{ statusMark(s.status) }}</span>
            <span class="sname">{{ s.title }}</span>
            <span class="spacer"></span>
            <span class="tiny muted mono">{{ s.duration_ms ? (s.duration_ms / 1000).toFixed(1) + 's' : '' }}</span>
            <span class="tiny muted mono">{{ s.llm_calls ? s.llm_calls + ' 次 LLM' : '' }}</span>
            <button class="sm ghost" @click="toggleStage(s.stage_key)">{{ openStage === s.stage_key ? '收起' : '查看原始数据' }}</button>
          </div>
          <div class="tiny muted ssum">{{ s.summary }}</div>
          <div v-if="openStage === s.stage_key" class="json">
            <div class="tiny muted jlabel">输出</div>
            <pre>{{ pretty(s.output_json) }}</pre>
            <div v-if="s.error" class="serr small">错误：{{ s.error }}</div>
          </div>
        </div>
      </div>
    </section>
    </template>
  </div>

  <div v-else class="empty">加载中…</div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api, notify } from '../api'
import Markdown from '../components/Markdown.vue'

const route = useRoute()
const router = useRouter()
const id = computed(() => route.params.id)

const loaded = ref(false)
const project = ref(null)
const run = ref(null)
const report = ref(null)
const available = ref([])
const evidences = ref([])
const sources = ref([])
const disagreements = ref([])
const sections = ref([])
const stages = ref([])
const variant = ref('standard')
const activeEvidence = ref(null)
const showProcess = ref(false)
const openStage = ref(null)
const srcLimit = ref(20)

/* ---- 版本（= 一次运行 run） ---- */
const versions = ref([])
const activeRunId = ref(null)
const currentRunId = ref(null)
const showNew = ref(false)
const creating = ref(false)
const finalizing = ref(false)
const nv = reactive({ mode: 'standard', genre: 'auto', tone: 'professional' })
const nvTouched = ref(false)

/**
 * 能不能「补跑装配」：该版本已经有写好的章节，只是报告成品没产出。
 * 这种情况下前三档报告可以直接从库里已有素材装配出来，不需要重新检索/重新写。
 */
const canFinalize = computed(() =>
  !!activeVersion.value
  && activeVersion.value.status !== 'running'
  && sections.value.length > 0
)

const activeVersion = computed(() => versions.value.find(v => v.runId === activeRunId.value) || null)

const variants = [
  { key: 'brief', label: '速览', desc: '一屏看懂' },
  { key: 'standard', label: '标准', desc: '完整论证' },
  { key: 'deep', label: '深度', desc: '数据细节' }
]

const quality = computed(() => {
  try { return JSON.parse(report.value?.quality_json || '{}') } catch { return {} }
})

const sortedSources = computed(() => {
  const rank = { A: 0, B: 1, C: 2, U: 3, D: 4 }
  return [...sources.value].sort((a, b) =>
    (rank[a.authority_tier] ?? 5) - (rank[b.authority_tier] ?? 5) || (b.quality_score || 0) - (a.quality_score || 0))
})

const dataPoints = computed(() => {
  try { return JSON.parse(activeEvidence.value?.data_json || '[]') } catch { return [] }
})

async function load(v = variant.value) {
  try {
    const qs = new URLSearchParams({ variant: v })
    if (activeRunId.value) qs.set('runId', activeRunId.value)
    const r = await api.get(`/api/reports/project/${id.value}?${qs.toString()}`)
    project.value = r.project
    run.value = r.run
    report.value = r.report
    available.value = r.availableVariants || []
    evidences.value = r.evidences || []
    sources.value = r.sources || []
    disagreements.value = r.disagreements || []
    sections.value = r.sections || []
    versions.value = r.versions || []
    currentRunId.value = r.project?.current_run_id || null
    if (r.run?.id) activeRunId.value = r.run.id
    if (!showNew.value) {
      nv.mode = r.project?.mode || 'standard'
      nv.genre = r.project?.genre || 'auto'
      try { nv.tone = JSON.parse(r.project?.options_json || '{}').tone || 'professional' } catch { nv.tone = 'professional' }
    }
    if (!available.value.includes(variant.value) && available.value.length) variant.value = available.value[0]
    loaded.value = true
  } catch (e) {
    loaded.value = true
  }
}

/* ---- 版本操作 ---- */
function switchVersion(runId) {
  if (runId === activeRunId.value) return
  activeRunId.value = runId
  activeEvidence.value = null
  openStage.value = null
  stages.value = []
  showProcess.value = false
  load(variant.value)
}

function openNewVersion() {
  nv.mode = project.value?.mode || 'standard'
  nv.genre = project.value?.genre || 'auto'
  try { nv.tone = JSON.parse(project.value?.options_json || '{}').tone || 'professional' } catch { nv.tone = 'professional' }
  showNew.value = true
}

async function createVersion() {
  creating.value = true
  try {
    const r = await api.post(`/api/projects/${id.value}/versions`, { ...nv })
    notify(`已开始生成 v${r.seq}`, 'ok')
    router.push(`/live/${id.value}`)
  } catch (e) {
    notify(String(e.message), 'err')
  } finally {
    creating.value = false
  }
}

async function removeVersion() {
  const v = activeVersion.value
  if (!v) return
  if (!confirm(`删除版本 v${v.seq}？\n该版本的报告、证据、检索记录会一并删掉，其它版本不受影响。`)) return
  try {
    await api.del(`/api/projects/${id.value}/versions/${v.runId}`)
    notify(`已删除 v${v.seq}`, 'ok')
    const rest = versions.value.filter(x => x.runId !== v.runId)
    if (!rest.length) { router.push('/'); return }
    versions.value = rest
    activeRunId.value = rest[rest.length - 1].runId
    activeEvidence.value = null
    report.value = null
    load(variant.value)
  } catch (e) {
    notify(String(e.message), 'err')
  }
}

function vstatus(s) {
  return {
    running: '生成中', succeeded: '已完成', failed: '失败',
    aborted: '已终止', paused: '已暂停', budget_exceeded: '超预算'
  }[s] || (s || '未知')
}

/** 补跑装配：从 render 阶段续跑，前面的阶段 runner 会自动跳过 */
async function finalizeVersion() {
  const v = activeVersion.value
  if (!v) return
  finalizing.value = true
  try {
    await api.post(`/api/runs/${v.runId}/rerun`, { stage: 'render' })
    notify('已从「装配」阶段开始补跑，完成后会自动出现在这里', 'ok')
    router.push(`/live/${id.value}`)
  } catch (e) {
    notify(String(e.message || e), 'err')
  } finally {
    finalizing.value = false
  }
}

async function loadStages() {
  if (!run.value) return
  try {
    const r = await api.get(`/api/runs/${run.value.id}/stages`)
    stages.value = r.items || []
  } catch {}
}

function switchVariant(v) {
  if (!available.value.includes(v)) return
  variant.value = v
  load(v)
  activeEvidence.value = null
}

function openEvidence(evId) {
  const e = evidences.value.find(x => Number(x.id) === Number(evId))
  if (e) activeEvidence.value = e
}

function toggleStage(k) { openStage.value = openStage.value === k ? null : k }

function pretty(v) {
  if (!v) return '（无）'
  if (typeof v === 'string') { try { return JSON.stringify(JSON.parse(v), null, 2) } catch { return v } }
  return JSON.stringify(v, null, 2)
}

function exportAs(fmt) {
  const qs = `variant=${variant.value}${activeRunId.value ? `&runId=${activeRunId.value}` : ''}`
  window.location.href = `/api/reports/project/${id.value}/export/${fmt}?${qs}`
}
function printPdf() { window.print() }

function tierBadge(t) { return { A: 'green', B: 'blue', C: 'amber', D: 'red', U: 'gray' }[t] || 'gray' }
function confBadge(c) { return { high: 'green', medium: 'blue', low: 'amber', disputed: 'red' }[c] || 'gray' }
function confLabel(c) { return { high: '高置信', medium: '中置信', low: '低置信', disputed: '存疑' }[c] || c }
function adjBadge(a) { return { adjudicated: 'green', unresolved: 'red', partially: 'amber' }[a] || 'gray' }
function adjLabel(a) { return { adjudicated: '已裁决', unresolved: '未裁决', partially: '部分裁决' }[a] || a }
function sevBadge(s) { return { high: 'red', medium: 'amber', low: 'gray' }[s] || 'gray' }
function sevLabel(s) { return { high: '分歧大', medium: '分歧中', low: '分歧小' }[s] || s }
function modeLabel(m) { return { quick: '快看', standard: '标准', deep: '深研' }[m] || '' }
function genreLabel(g) { return { auto: '', life: '生活日常', ent: '娱乐文化', society: '社会公共', biz: '商业财经', tech: '科技知识' }[g] || '' }
function statusMark(s) { return { succeeded: '✓', succeeded_with_warnings: '✓', failed: '✗', skipped: '↷', running: '◐' }[s] || '·' }
function fmt(t) {
  if (!t) return '—'
  const d = new Date(String(t).replace(' ', 'T') + 'Z')
  return isNaN(d) ? String(t).slice(0, 16) : d.toLocaleString('zh-CN')
}

watch(showProcess, (v) => { if (v && !stages.value.length) loadStages() })
onMounted(() => load())
</script>

<style scoped>
.report { max-width: 1240px; margin: 0 auto; padding: 26px 24px 60px; display: flex; flex-direction: column; gap: 16px; }
.top { display: flex; align-items: flex-start; gap: 16px; flex-wrap: wrap; }
.head-main { min-width: 0; flex: 1; }
.kicker { font-size: 11px; font-weight: 700; letter-spacing: .08em; color: var(--primary); }
.head-main h1 { font-size: 25px; margin: 3px 0 6px; }
.meta-row { gap: 4px; flex-wrap: wrap; }

/* ---- 版本条 ---- */
.vbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 8px 12px; }
.vlabel { font-size: 11px; font-weight: 700; letter-spacing: .06em; color: var(--text-3); }
.vchips { display: flex; gap: 6px; flex-wrap: wrap; }
.vchip { position: relative; padding: 4px 12px; font-size: 13px; border-radius: 999px; white-space: nowrap; }
.vchip.on { background: var(--primary); color: #fff; border-color: var(--primary); font-weight: 600; }
.vchip.running { border-style: dashed; }
.vchip.add { border-style: dashed; color: var(--primary); }
.vchip .dot { position: absolute; top: -3px; right: -3px; width: 8px; height: 8px; border-radius: 50%;
  background: var(--ok); border: 2px solid var(--panel); }
.vchip.on .dot { border-color: var(--primary); }
.danger { color: var(--danger); border-color: #f0c2c2; }
.danger:disabled { opacity: .45; cursor: not-allowed; }

.newver { background: var(--panel-2); border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px; }
.nv-row { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
.fv { display: flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--text-3); white-space: nowrap; }
.fv select { padding: 4px 8px; font-size: 13px; }
.nv-tip { margin: 8px 0 0; line-height: 1.65; }

.nover-t { font-size: 15px; margin: 0 0 6px; }
.nover-tip {
  margin: 10px 0 0; max-width: 620px; line-height: 1.7;
  padding: 10px 12px; border-radius: 8px;
  background: var(--bg-soft, #f6f8fa); border: 1px solid var(--line, #e6e8eb);
}

.offline { background: var(--danger-bg); border: 1px solid #f5b5b5; color: #7f1d1d;
  padding: 12px 16px; border-radius: 8px; font-size: 13.5px; font-weight: 500; }

.tabs { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.tab { display: flex; flex-direction: column; align-items: flex-start; padding: 7px 16px; line-height: 1.3; }
.tab.on { background: var(--primary); color: #fff; border-color: var(--primary); }
.tab.on .muted { color: rgba(255,255,255,.75) !important; }

.body-grid { display: grid; grid-template-columns: 1fr; gap: 16px; align-items: start; }
.body-grid.with-panel { grid-template-columns: 1fr 340px; }

.doc { font-size: 15px; }
.doc :deep(h1:first-child) { margin-top: 0; }

.dis { margin-top: 40px; border-top: 2px solid var(--border); padding-top: 24px; }
.dis-card { border: 1px solid var(--border); border-radius: 10px; padding: 14px 16px; margin-bottom: 12px; background: var(--panel-2); }
.dis-head { margin-bottom: 10px; }
.dis-idx { width: 20px; height: 20px; border-radius: 50%; background: var(--text); color: #fff;
  font-size: 11px; font-weight: 700; display: flex; align-items: center; justify-content: center; }
.dis-topic { font-weight: 650; font-size: 14.5px; }
.positions { display: flex; flex-direction: column; gap: 6px; margin-bottom: 10px; }
.pos { display: flex; gap: 10px; padding: 7px 11px; background: var(--panel); border-radius: 6px; border: 1px solid var(--border); font-size: 13px; }
.pos-stance { flex: 0 0 88px; font-weight: 700; color: var(--primary); font-size: 12.5px; }
.pos-claim { flex: 1; }
.root { margin-top: 4px; }
.verdict { margin-top: 7px; padding: 8px 11px; background: var(--primary-soft); border-radius: 6px; color: #1e3a8a; }

.srcs { margin-top: 36px; border-top: 2px solid var(--border); padding-top: 22px; }
.src-filter { margin-bottom: 10px; }
.src-row { display: flex; align-items: center; gap: 9px; padding: 6px 0; border-bottom: 1px solid #f1f3f5; font-size: 13px; }
.src-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text); }

.ev-panel { position: sticky; top: 16px; max-height: calc(100vh - 40px); overflow-y: auto; }
.side-title { font-size: 11px; font-weight: 700; color: var(--text-3); letter-spacing: .05em; }
.ev-badges { margin-bottom: 12px; flex-wrap: wrap; gap: 5px; }
.ev-claim { font-size: 14.5px; font-weight: 600; line-height: 1.6; margin-bottom: 14px; }
.ev-block { margin-bottom: 14px; }
.ev-label { font-size: 11px; font-weight: 700; color: var(--text-3); margin-bottom: 5px; letter-spacing: .04em; }
.ev-quote { margin: 0; padding: 10px 12px; background: var(--panel-2); border-left: 3px solid var(--border-strong);
  border-radius: 0 6px 6px 0; font-size: 12.5px; color: var(--text-2); max-height: 220px; overflow-y: auto; }
.ev-src { font-size: 13px; word-break: break-all; }
.dp { display: flex; justify-content: space-between; gap: 8px; font-size: 12.5px; padding: 3px 0; border-bottom: 1px dotted var(--border); }
.infer { background: var(--warn-bg); padding: 10px 12px; border-radius: 6px; }
.warn-note { color: var(--warn); margin-top: 6px; }

.process .stages { margin-top: 14px; }
.stage-row { padding: 10px 0; border-bottom: 1px solid var(--border); }
.smark { width: 18px; font-weight: 700; color: var(--ok); }
.sname { font-weight: 600; font-size: 13.5px; }
.ssum { margin-top: 3px; color: var(--text-2); }
.json { margin-top: 10px; }
.jlabel { margin-bottom: 4px; }
.json pre { max-height: 340px; overflow: auto; font-size: 11.5px; background: #f8f9fa; }
.serr { color: var(--danger); margin-top: 8px; }

@media print {
  .top .row, .tabs, .ev-panel, .process { display: none !important; }
  .body-grid { grid-template-columns: 1fr !important; }
}
@media (max-width: 980px) {
  .body-grid.with-panel { grid-template-columns: 1fr; }
  .ev-panel { position: static; max-height: none; }
}
</style>
