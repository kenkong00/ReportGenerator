<template>
  <div class="home">
    <div class="hero">
      <h1>就一个问题，给你一份能追溯来源、敢说"没定论"的调研报告</h1>
      <p class="muted">
        不管是严肃的财经 / 社会学课题，还是茶余饭后想扒一扒的猎奇话题，都能跑。
        系统会把问题拆解成多个子问题，联网广泛取证，评估每个来源的可信度，
        从多个视角交叉论证，最后产出一份<b>每句话都能追溯到来源</b>的报告——
        包括那些说不清楚、各方打架的地方，它会老实告诉你"这里没定论"。
      </p>
    </div>

    <div class="card pad input-card">
      <textarea
        v-model="topic"
        rows="3"
        placeholder="输入你想搞清楚的问题。严肃的、生活的、猎奇的都行。例：&#10;中国 GDP 的构成和真实情况到底是怎样的？&#10;2025 年最火的算命 / 玄学方式是哪一种？&#10;年轻人为什么突然都爱上了露营？"
        @keydown.ctrl.enter="start"
      ></textarea>

      <div class="row mode-row">
        <span class="small muted">题材</span>
        <div class="seg">
          <button
            v-for="g in genres" :key="g.key"
            class="seg-btn" :class="{ on: genre === g.key }"
            @click="genre = g.key"
          >
            {{ g.label }}
          </button>
        </div>
        <span class="small muted ellipsis">{{ currentGenreHint }}</span>
      </div>

      <div class="row mode-row">
        <span class="small muted">报告深度</span>
        <div class="seg">
          <button
            v-for="m in modes" :key="m.key"
            class="seg-btn" :class="{ on: mode === m.key }"
            @click="mode = m.key"
          >
            {{ m.label }}
          </button>
        </div>
        <span class="small muted">{{ currentModeHint }}</span>
      </div>

      <div class="row mode-row">
        <span class="small muted">报告风格</span>
        <div class="seg">
          <button
            v-for="t in tones" :key="t.key"
            class="seg-btn" :class="{ on: tone === t.key }"
            @click="tone = t.key"
          >
            {{ t.label }}
          </button>
        </div>
        <span class="small muted">{{ currentToneHint }}</span>
        <span class="spacer"></span>
        <button class="primary" :disabled="!topic.trim() || starting" @click="start">
          {{ starting ? '正在启动…' : '开始调研' }}
        </button>
      </div>

      <div v-if="!configured" class="notice warn">
        ⚠️ 还没配置大模型。请先到
        <router-link to="/settings">设置页</router-link>
        填入 DeepSeek / 硅基流动 / 通义的 API Key，否则系统无法生成报告。
      </div>
    </div>

    <div class="examples">
      <div class="examples-head">
        <span class="muted small">没灵感？挑一个好玩的选题（点一下就填进上面）：</span>
      </div>
      <div v-for="cat in exampleCats" :key="cat.name" class="cat">
        <div class="cat-name">{{ cat.name }}</div>
        <div class="chips">
          <button
            v-for="q in cat.items" :key="q"
            class="chip" :class="{ on: topic === q }"
            @click="pickExample(q)"
          >{{ q }}</button>
        </div>
      </div>
    </div>

    <div class="section-head">
      <h2>历史调研</h2>
      <span class="spacer"></span>
      <input v-model="kw" class="kw" placeholder="搜索标题…" @input="loadList" />
    </div>

    <div v-if="list.length" class="list">
      <div v-for="p in list" :key="p.id" class="card pad item">
        <div class="row">
          <span class="badge" :class="badgeClass(p.status)">{{ statusLabel(p.status) }}</span>
          <span class="badge gray">{{ modeLabel(p.mode) }}</span>
          <span v-if="genreLabel(p.genre)" class="badge gray">{{ genreLabel(p.genre) }}</span>
          <span v-if="(p.version_count || 1) > 1" class="badge blue">{{ p.version_count }} 个版本</span>
          <span class="spacer"></span>
          <span class="tiny muted">{{ fmt(p.updated_at) }}</span>
        </div>
        <div class="title" @click="open(p)">{{ p.title }}</div>
        <div class="row">
          <span class="tiny muted ellipsis">{{ p.raw_topic }}</span>
          <span class="spacer"></span>
          <button v-if="canResume(p)" class="sm primary" @click="resume(p)">▶ 继续</button>
          <button v-if="p.status !== 'running'" class="sm" @click="rerun(p)">＋ 新版本</button>
          <button class="sm" @click="open(p)">
            {{ isDone(p) ? '查看报告' : '查看进度' }}
          </button>
          <button class="sm ghost danger" @click="remove(p)">删除</button>
        </div>
      </div>
    </div>
    <div v-else class="empty">还没有调研记录。输入一个问题试试。</div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { api, notify } from '../api'

const router = useRouter()
const topic = ref('')
const mode = ref('standard')
const tone = ref('professional')
const genre = ref('auto')
const starting = ref(false)
const list = ref([])
const kw = ref('')
const configured = ref(true)

// 深度：决定"做多少功课"，而不是"写得多正经"
const modes = [
  { key: 'quick', label: '快看', hint: '约 6~10 分钟 · 只做信息聚合，快速摸清情况' },
  { key: 'standard', label: '标准', hint: '约 15 分钟 · 分节讲清来龙去脉' },
  { key: 'deep', label: '深研', hint: '约 35 分钟 · 多来源 + 逐节扩写，适合严肃课题' }
]

// 风格：不光是措辞，还会换掉报告的骨架
const tones = [
  { key: 'professional', label: '严肃', hint: '研究报告体：结论先行、分节论证' },
  { key: 'casual', label: '轻松', hint: '生活漫谈体：大白话、一节能讲明白一件事' },
  { key: 'playful', label: '搞怪', hint: '榜单/清单体：带梗带 emoji，但每个条目都得有干货' }
]

// 题材：决定整套拆题角度与"什么算可信来源"
const genres = [
  { key: 'auto', label: '自动', hint: '系统先读一遍题目，自动选题材（推荐）' },
  { key: 'life', label: '生活', hint: '吃喝玩乐 / 消费体验 / 两性情感 / 健康 / 家居' },
  { key: 'ent', label: '娱乐', hint: '明星 / 影视 / 动漫 / 游戏 / 网红 / 八卦 / 亚文化' },
  { key: 'society', label: '社会', hint: '政策法规 / 公共事件 / 教育医疗 / 社会现象' },
  { key: 'biz', label: '财经', hint: '公司 / 产业 / 市场 / 投资 / 经济' },
  { key: 'tech', label: '科技', hint: '技术 / 产品 / 互联网 / 科研 / 历史人文' }
]

const currentModeHint = computed(() => modes.find(m => m.key === mode.value)?.hint || '')
const currentToneHint = computed(() => tones.find(t => t.key === tone.value)?.hint || '')
const currentGenreHint = computed(() => genres.find(g => g.key === genre.value)?.hint || '')

const exampleCats = [
  { name: '🔮 玄学娱乐', items: [
    '2025 年最火的算命 / 玄学方式是哪一种？',
    '年轻人都在偷偷信什么玄学？MBTI 还是星座？',
    '塔罗牌、算卦、看相，到底谁在掏年轻人的钱包？'
  ] },
  { name: '🛍️ 生活消费', items: [
    '年轻人为什么突然都爱上了露营？',
    '今年女生最爱送男朋友什么礼物？',
    '为什么方便面总感觉少了一块？'
  ] },
  { name: '🐱 猎奇冷知识', items: [
    '猫到底有没有在心里骂主人？',
    '人类打哈欠为什么会传染？',
    '为什么深夜的食欲总是比白天更猛？'
  ] },
  { name: '👀 社会观察', items: [
    '为什么年轻人开始热衷于「断亲」？',
    '现在的相亲市场到底有多离谱？',
    '「听劝」文学为什么突然火了？'
  ] },
  { name: '💡 数码科技', items: [
    '为什么手机越做越贵，拍照却越拍越烂？',
    '百元机和旗舰机的差距真有那么大吗？',
    '为什么 App 总是想方设法不让你卸载？'
  ] }
]

function pickExample(q) {
  topic.value = q
}

async function loadList() {
  try {
    const r = await api.get(`/api/projects?limit=50&keyword=${encodeURIComponent(kw.value)}`)
    list.value = r.items || []
  } catch {}
}

async function checkConfigured() {
  try {
    const r = await api.get('/api/settings')
    const s = r.settings || {}
    configured.value = !!(s['llm.compat.apiKey'] || s['llm.cloud.publishableKey'])
  } catch { configured.value = false }
}

async function start() {
  if (!topic.value.trim()) return
  starting.value = true
  try {
    const r = await api.post('/api/projects', {
      rawTopic: topic.value.trim(),
      mode: mode.value,
      genre: genre.value,
      options: { enableClarify: false, enableFetch: true, tone: tone.value }
    })
    const id = r.project.id
    await api.post(`/api/projects/${id}/run`, {})
    window.dispatchEvent(new Event('project-changed'))
    router.push(`/live/${id}`)
  } catch (e) {
    notify(String(e.message))
  } finally {
    starting.value = false
  }
}

function isDone(p) { return ['done', 'succeeded'].includes(p.status) }
// budget_exceeded = 跑完了但没产出报告（如装配阶段被跳过），允许继续/补跑
function canResume(p) { return ['paused', 'failed', 'aborted', 'budget_exceeded'].includes(p.status) }

async function resume(p) {
  try {
    await api.post(`/api/projects/${p.id}/run`, { resume: true })
    notify('已继续：从断点接着跑', 'ok')
    router.push(`/live/${p.id}`)
  } catch (e) { notify(String(e.message), 'err') }
}

/** 同一主题再跑一版（用项目当前的深度/题材/风格） */
async function rerun(p) {
  try {
    const r = await api.post(`/api/projects/${p.id}/versions`, {})
    notify(`已开始生成 v${r.seq}`, 'ok')
    loadList()
    router.push(`/live/${p.id}`)
  } catch (e) { notify(String(e.message), 'err') }
}

function open(p) {
  router.push(isDone(p) ? `/report/${p.id}` : `/live/${p.id}`)
}

async function remove(p) {
  if (!confirm(`删除「${p.title}」？`)) return
  await api.del(`/api/projects/${p.id}`)
  loadList()
  window.dispatchEvent(new Event('project-changed'))
}

function statusLabel(s) {
  return {
    draft: '草稿', running: '进行中', paused: '已暂停', failed: '失败',
    aborted: '已终止', succeeded: '已完成', done: '已完成',
    budget_exceeded: '未出报告'
  }[s] || s
}
function badgeClass(s) {
  return { done: 'green', succeeded: 'green', running: 'blue', failed: 'red', aborted: 'gray', paused: 'amber', budget_exceeded: 'amber' }[s] || 'gray'
}
function modeLabel(m) {
  return { quick: '快看', standard: '标准', deep: '深研' }[m] || m
}
function genreLabel(g) {
  return { auto: '自动', life: '生活', ent: '娱乐', society: '社会', biz: '财经', tech: '科技' }[g] || ''
}
function fmt(t) {
  if (!t) return ''
  const d = new Date(t.replace(' ', 'T') + 'Z')
  return isNaN(d) ? t.slice(0, 16) : d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

onMounted(() => { loadList(); checkConfigured() })
</script>

<style scoped>
.home { max-width: 880px; margin: 0 auto; padding: 36px 28px 60px; }
.hero h1 { font-size: 27px; margin-bottom: 10px; letter-spacing: -.01em; }
.hero p { font-size: 14px; max-width: 640px; margin-bottom: 26px; }

.input-card { margin-bottom: 24px; }
.input-card textarea { font-size: 15px; padding: 14px; }

.examples { margin-bottom: 30px; border: 1px dashed var(--border-strong); border-radius: 10px; padding: 14px 16px; background: var(--panel); }
.examples-head { margin-bottom: 10px; }
.cat { margin-bottom: 10px; }
.cat:last-child { margin-bottom: 0; }
.cat-name { font-size: 12.5px; font-weight: 650; color: var(--text-soft); margin-bottom: 6px; }
.chips { display: flex; flex-wrap: wrap; gap: 8px; }
.chip {
  border: 1px solid var(--border); background: var(--bg-soft); color: var(--text);
  border-radius: 999px; padding: 6px 13px; font-size: 13px; cursor: pointer;
  transition: all .12s;
}
.chip:hover { border-color: var(--primary); color: var(--primary); }
.chip.on { background: var(--primary); border-color: var(--primary); color: #fff; }

.mode-row { margin-top: 14px; flex-wrap: wrap; gap: 12px; }
.seg { display: flex; border: 1px solid var(--border-strong); border-radius: 7px; overflow: hidden; }
.seg-btn { border: none; border-radius: 0; padding: 6px 16px; background: var(--panel); }
.seg-btn + .seg-btn { border-left: 1px solid var(--border); }
.seg-btn.on { background: var(--primary); color: #fff; font-weight: 600; }

.notice { margin-top: 14px; padding: 11px 14px; border-radius: 7px; font-size: 13px; }
.notice.warn { background: var(--warn-bg); border: 1px solid #fcd9a4; color: #78350f; }

.section-head { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; }
.section-head h2 { margin: 0; font-size: 17px; }
.kw { width: 200px; padding: 6px 10px; font-size: 13px; }

.list { display: flex; flex-direction: column; gap: 10px; }
.item { transition: box-shadow .15s; }
.item:hover { box-shadow: var(--shadow-md); }
.title { font-size: 15.5px; font-weight: 650; margin: 9px 0; cursor: pointer; }
.title:hover { color: var(--primary); }
.ellipsis { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 460px; }
</style>
