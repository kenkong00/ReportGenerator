<template>
  <div class="prompts">
    <div class="head">
      <div>
        <h1>提示词管理</h1>
        <p class="muted small">
          系统里 AI 每一步用到的提示词都在这里，<b>全部公开、可增删改</b>。改完点保存即生效（无需重启）。
          左侧选一条，右侧编辑；形如 <code>{{ brace('变量名') }}</code> 的是运行时会自动填入的占位符。
        </p>
      </div>
      <div class="row">
        <button class="sm" @click="showSystemPreview = !showSystemPreview">查看系统底座</button>
        <button class="sm" @click="doExport">导出</button>
        <button class="sm" @click="fileInput && fileInput.click()">导入</button>
        <button class="sm" @click="resetAll">全部恢复默认</button>
        <button class="sm" @click="createNew">＋ 新建</button>
        <input ref="fileInput" type="file" accept="application/json,.json" style="display:none" @change="doImport" />
      </div>
    </div>

    <div class="layout">
      <!-- 左：分类 + 列表 -->
      <aside class="list card">
        <div class="cats">
          <button
            v-for="c in catList" :key="c.key"
            class="cat" :class="{ on: activeCat === c.key }"
            @click="activeCat = c.key"
          >
            {{ c.label }}
            <span class="cnt">{{ countOf(c.key) }}</span>
          </button>
        </div>
        <div class="items">
          <div
            v-for="it in filtered" :key="it.key"
            class="item" :class="{ on: cur?.key === it.key }"
            @click="select(it.key)"
          >
            <div class="item-name">
              <span class="ellipsis">{{ it.name }}</span>
              <span v-if="it.isModified" class="dot-mod" title="已修改">●</span>
              <span v-if="!it.enabled" class="badge gray">停用</span>
            </div>
            <div class="tiny mono muted ellipsis">{{ it.key }}</div>
          </div>
          <div v-if="!filtered.length" class="empty tiny">该分类下暂无提示词</div>
        </div>
      </aside>

      <!-- 右：编辑器 -->
      <section class="editor card" v-if="cur">
        <div class="editor-head">
          <div class="row" style="gap:8px; flex-wrap:wrap">
            <input v-model="draft.name" class="name-input" />
            <span class="badge blue">{{ catLabel(cur.category) }}</span>
            <span v-if="cur.isBuiltin" class="badge gray">内置</span>
            <span v-else class="badge green">自建</span>
            <span v-if="cur.stageKey" class="badge gray">阶段：{{ cur.stageKey }}</span>
          </div>
          <div class="row">
            <label class="toggle">
              <input type="checkbox" v-model="draft.enabled" /> 启用
            </label>
          </div>
        </div>

        <div class="key-line tiny mono muted">key: {{ cur.key }}</div>
        <p class="desc small">{{ cur.description }}</p>

        <div v-if="cur.variables?.length" class="vars">
          <div class="vars-title small">可用变量（运行时会替换成真实内容）</div>
          <div class="vars-list">
            <div v-for="v in cur.variables" :key="v.name" class="var">
              <code>{{ brace(v.name) }}</code>
              <span class="tiny muted">{{ v.desc }}</span>
            </div>
          </div>
        </div>

        <div class="row" style="margin:10px 0 6px">
          <span class="small muted">模板内容</span>
          <span class="spacer"></span>
          <button class="sm" @click="doPreview">渲染预览</button>
          <button v-if="cur.isBuiltin" class="sm" @click="doResetOne">恢复默认</button>
          <button v-else class="sm danger" @click="doDelete">删除</button>
        </div>

        <textarea v-model="draft.template" class="ed" spellcheck="false"></textarea>

        <div class="row" style="margin-top:10px">
          <span v-if="cur.isModified" class="tiny" style="color:var(--warn)">⚠ 已修改（与出厂默认不同）</span>
          <span class="spacer"></span>
          <button class="primary" :disabled="saving" @click="doSave">{{ saving ? '保存中…' : '保存' }}</button>
        </div>

        <div v-if="previewText" class="preview">
          <div class="row">
            <span class="small muted">渲染预览（用示例变量填入）</span>
            <span class="spacer"></span>
            <button class="sm ghost" @click="previewText = ''">关闭</button>
          </div>
          <pre class="mono">{{ previewText }}</pre>
        </div>
      </section>
      <section v-else class="editor card empty">左侧选择一条提示词</section>
    </div>

    <!-- 系统底座预览 -->
    <div v-if="showSystemPreview" class="modal-mask" @click.self="showSystemPreview = false">
      <div class="modal card pad">
        <div class="row">
          <h3 style="margin:0">系统底座（每次调用的总规则）</h3>
          <span class="spacer"></span>
          <select v-model="previewTone" style="width:120px" @change="loadSystemPreview">
            <option value="professional">严肃</option>
            <option value="casual">轻松</option>
            <option value="playful">搞怪</option>
          </select>
          <select v-model="previewGenre" style="width:120px" @change="loadSystemPreview">
            <option value="auto">题材·通用</option>
            <option value="life">生活日常</option>
            <option value="ent">娱乐文化</option>
            <option value="society">社会公共</option>
            <option value="biz">商业财经</option>
            <option value="tech">科技知识</option>
          </select>
          <button class="sm" @click="showSystemPreview = false">关闭</button>
        </div>
        <p class="small muted">这是把 system.base + 内容政策 + 题材语境 + 当前风格拼装后的最终 system 提示词。</p>
        <pre class="mono sysprev">{{ systemPreview }}</pre>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { api, notify } from '../api'

const items = ref([])
const cats = ref({})
const activeCat = ref('system')
const cur = ref(null)
const draft = ref({ name: '', template: '', enabled: true })
const saving = ref(false)
const previewText = ref('')
const showSystemPreview = ref(false)
const previewTone = ref('professional')
const previewGenre = ref('auto')
const systemPreview = ref('')

function brace(name) { return '\u007b\u007b' + name + '\u007d\u007d' }

const catList = computed(() => Object.entries(cats.value)
  .map(([key, m]) => ({ key, ...m }))
  .sort((a, b) => (a.order ?? 9) - (b.order ?? 9)))

const filtered = computed(() => items.value.filter(x => x.category === activeCat.value))
function countOf(k) { return items.value.filter(x => x.category === k).length }
function catLabel(k) { return cats.value[k]?.label || k }

async function load() {
  const r = await api.get('/api/prompts')
  items.value = r.items || []
  cats.value = r.categories || {}
  if (!cats.value[activeCat.value]) activeCat.value = catList.value[0]?.key || 'system'
  const still = items.value.find(x => x.key === cur.value?.key)
  if (still) select(still.key)
}

function select(key) {
  const it = items.value.find(x => x.key === key)
  if (!it) return
  cur.value = it
  draft.value = { name: it.name, template: it.template, enabled: it.enabled }
  previewText.value = ''
}

async function doSave() {
  if (!cur.value) return
  saving.value = true
  try {
    const r = await api.put(`/api/prompts/${encodeURIComponent(cur.value.key)}`, {
      name: draft.value.name,
      template: draft.value.template,
      enabled: draft.value.enabled
    })
    notify('已保存，立即生效', 'ok')
    await load()
    select(cur.value.key)
  } catch (e) { notify(String(e.message), 'err') }
  finally { saving.value = false }
}

async function doResetOne() {
  if (!cur.value) return
  if (!confirm(`把「${cur.value.name}」恢复为出厂默认？`)) return
  await api.post(`/api/prompts/${encodeURIComponent(cur.value.key)}/reset`, {})
  notify('已恢复默认', 'ok')
  await load(); select(cur.value.key)
}

async function doDelete() {
  if (!cur.value) return
  if (!confirm(`删除自建提示词「${cur.value.name}」？`)) return
  try {
    await api.del(`/api/prompts/${encodeURIComponent(cur.value.key)}`)
    notify('已删除', 'ok')
    cur.value = null
    await load()
  } catch (e) { notify(String(e.message), 'err') }
}

async function doPreview() {
  const variables = {}
  for (const v of cur.value.variables || []) variables[v.name] = `〔${v.name} 示例〕`
  const r = await api.post('/api/prompts/preview', { template: draft.value.template, variables })
  previewText.value = r.rendered || ''
}

async function createNew() {
  const key = prompt('给这条提示词起一个唯一 key（英文/数字/点，如 custom.seoHint）：')
  if (!key) return
  const name = prompt('中文名：') || key
  try {
    await api.post('/api/prompts', { key, name, category: 'custom', description: '用户自建提示词', template: '' })
    notify('已创建', 'ok')
    activeCat.value = 'custom'
    await load(); select(key)
  } catch (e) { notify(String(e.message), 'err') }
}

async function resetAll() {
  if (!confirm('把【所有内置提示词】恢复为出厂默认？（自建项不受影响）')) return
  await api.post('/api/prompts/reset-all', {})
  notify('已全部恢复默认', 'ok')
  await load()
}

/* ---- 导出 / 导入（备份与分享提示词方案）---- */
const fileInput = ref(null)

async function doExport() {
  try {
    const r = await api.get('/api/prompts/export')
    const items = r.items || []
    const blob = new Blob([JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), items }, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `prompts-${new Date().toISOString().slice(0, 10)}.json`
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(a.href), 3000)
    notify(`已导出 ${items.length} 条提示词`, 'ok')
  } catch (e) { notify('导出失败：' + String(e.message), 'err') }
}

async function doImport(ev) {
  const f = ev.target.files && ev.target.files[0]
  if (!f) return
  try {
    const payload = JSON.parse(await f.text())
    const items = Array.isArray(payload) ? payload : (payload.items || [])
    if (!items.length) { notify('文件里没有可导入的提示词', 'err'); return }
    const r = await api.post('/api/prompts/import', { items })
    notify(`已导入 ${r.imported ?? items.length} 条`, 'ok')
    await load()
  } catch (e) {
    notify('导入失败：' + String(e.message), 'err')
  } finally {
    ev.target.value = ''
  }
}

async function loadSystemPreview() {
  const r = await api.get(`/api/prompts/preview-system?tone=${previewTone.value}&genre=${previewGenre.value}`)
  systemPreview.value = r.rendered || ''
}

import { watch } from 'vue'
watch(showSystemPreview, v => { if (v) loadSystemPreview() })

onMounted(load)
</script>

<style scoped>
.prompts { max-width: 1200px; margin: 0 auto; padding: 28px 26px 60px; }
.head { display: flex; justify-content: space-between; align-items: flex-start; gap: 20px; margin-bottom: 18px; flex-wrap: wrap; }
.head h1 { font-size: 22px; margin-bottom: 6px; }
.head p { max-width: 640px; margin: 0; }

.layout { display: grid; grid-template-columns: 300px 1fr; gap: 16px; align-items: start; }
@media (max-width: 900px) { .layout { grid-template-columns: 1fr; } }

.list { padding: 10px; display: flex; flex-direction: column; gap: 8px; max-height: 78vh; }
.cats { display: flex; flex-wrap: wrap; gap: 6px; padding-bottom: 8px; border-bottom: 1px solid var(--border); }
.cat { border: 1px solid var(--border); background: var(--panel-2); font-size: 12px; padding: 5px 10px; border-radius: 20px; }
.cat.on { background: var(--primary); color: #fff; border-color: var(--primary); font-weight: 600; }
.cnt { opacity: .7; margin-left: 4px; font-size: 11px; }
.items { overflow-y: auto; display: flex; flex-direction: column; gap: 3px; }
.item { padding: 8px 10px; border-radius: 7px; cursor: pointer; border: 1px solid transparent; }
.item:hover { background: var(--panel-2); }
.item.on { background: var(--primary-soft); border-color: #cddafc; }
.item-name { display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 600; }
.dot-mod { color: var(--warn); font-size: 9px; }
.ellipsis { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.editor { padding: 16px; }
.editor-head { display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; }
.name-input { width: 300px; font-weight: 650; }
.key-line { margin: 8px 0 2px; }
.desc { margin: 4px 0 10px; color: var(--text-2); }
.toggle { display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 500; color: var(--text-2); }
.toggle input { width: auto; }

.vars { background: var(--panel-2); border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; margin-bottom: 8px; }
.vars-title { font-weight: 650; color: var(--text-2); margin-bottom: 6px; }
.vars-list { display: flex; flex-direction: column; gap: 3px; }
.var { display: flex; gap: 10px; align-items: baseline; }
.var code { background: #eef2ff; color: var(--primary); }

.ed { min-height: 340px; font-family: var(--mono); font-size: 13px; line-height: 1.6; }

.preview { margin-top: 14px; border-top: 1px dashed var(--border-strong); padding-top: 10px; }
.preview pre { max-height: 320px; overflow: auto; font-size: 12.5px; white-space: pre-wrap; }

.modal-mask { position: fixed; inset: 0; background: rgba(16,24,40,.45); display: flex; align-items: center; justify-content: center; z-index: 900; padding: 24px; }
.modal { width: 860px; max-width: 94vw; max-height: 86vh; overflow: auto; }
.sysprev { max-height: 60vh; overflow: auto; white-space: pre-wrap; font-size: 12.5px; }
</style>
