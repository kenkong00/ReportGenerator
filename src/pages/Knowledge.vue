<template>
  <div class="kb">
    <h1>知识库</h1>
    <p class="small muted" style="margin-bottom:18px">
      把你已有的材料放进来，下次调研会自动检索并作为来源引用。
      报告完成后也可以一键沉淀进来，慢慢攒成你自己的知识体系。
    </p>

    <section class="card pad">
      <div class="row">
        <button :class="{ on: tab === 'paste' }" @click="tab = 'paste'">粘贴文本</button>
        <button :class="{ on: tab === 'url' }" @click="tab = 'url'">导入网页</button>
        <span class="spacer"></span>
        <span class="tiny muted">共 {{ stats.documents || 0 }} 篇 · {{ stats.chunks || 0 }} 个片段 · {{ fmtK(stats.chars || 0) }} 字</span>
      </div>

      <div v-if="tab === 'paste'" class="form">
        <div class="field">
          <label>标题</label>
          <input v-model="title" placeholder="例：比亚迪 2025 半年报要点摘录" />
        </div>
        <div class="field">
          <label>内容</label>
          <textarea v-model="text" rows="9" placeholder="把材料粘贴进来…"></textarea>
        </div>
      </div>

      <div v-else class="form">
        <div class="field">
          <label>网页地址</label>
          <input v-model="url" placeholder="https://…" />
        </div>
        <div class="tiny muted">系统会抓取该网页并抽取正文。部分站点反爬会失败，失败时会明确提示。</div>
      </div>

      <div class="row" style="margin-top:12px">
        <button class="primary" :disabled="saving" @click="add">
          {{ saving ? '处理中…' : '加入知识库' }}
        </button>
        <span class="spacer"></span>
        <span class="tiny muted">权威等级</span>
        <select v-model="tier" style="width:220px">
          <option value="A">A 一手权威</option>
          <option value="B">B 专业二手</option>
          <option value="C">C 需交叉验证</option>
        </select>
      </div>
    </section>

    <section class="card pad" style="margin-top:16px">
      <div class="row"><h2 style="margin:0;font-size:17px">已收录</h2>
        <span class="spacer"></span>
        <input v-model="q" placeholder="全文搜索…" style="width:240px" @keyup.enter="search" />
        <button class="sm" @click="search">搜索</button>
      </div>

      <div v-if="searchHits.length" class="hits">
        <div v-for="(h, i) in searchHits" :key="i" class="hit">
          <div class="row">
            <span class="badge" :class="tierBadge(h.authority_tier)">{{ h.authority_tier }}</span>
            <span class="small strong">{{ h.doc_title }}</span>
            <span class="spacer"></span>
            <span class="tiny muted">{{ h.heading || '' }}</span>
          </div>
          <div class="tiny muted hit-text">{{ h.text.slice(0, 180) }}…</div>
        </div>
      </div>

      <div v-else class="docs">
        <div v-for="d in docs" :key="d.id" class="doc-row">
          <span class="badge" :class="tierBadge(d.authority_tier)">{{ d.authority_tier }}</span>
          <span class="doc-title">{{ d.title }}</span>
          <span class="tiny muted">{{ { paste: '粘贴', url: '网页', report: '报告沉淀', file: '文件' }[d.source_type] || d.source_type }}</span>
          <span class="spacer"></span>
          <span class="tiny muted">{{ d.chunk_count }} 片段 · {{ fmtK(d.char_count) }} 字</span>
          <button class="sm ghost danger" @click="remove(d)">删除</button>
        </div>
        <div v-if="!docs.length" class="empty small">知识库还是空的。</div>
      </div>
    </section>
  </div>
</template>

<script setup>
import { ref, onMounted, reactive } from 'vue'
import { api, notify } from '../api'

const tab = ref('paste')
const title = ref('')
const text = ref('')
const url = ref('')
const tier = ref('C')
const saving = ref(false)
const docs = ref([])
const stats = reactive({})
const q = ref('')
const searchHits = ref([])

async function load() {
  try {
    const r = await api.get('/api/knowledge')
    docs.value = r.items || []
    Object.assign(stats, r.stats || {})
  } catch {}
}

async function add() {
  if (tab.value === 'paste' && !text.value.trim()) return notify('请输入内容')
  if (tab.value === 'url' && !url.value.trim()) return notify('请输入网址')
  saving.value = true
  try {
    await api.post('/api/knowledge', {
      title: title.value || undefined,
      text: tab.value === 'paste' ? text.value : undefined,
      url: tab.value === 'url' ? url.value : undefined,
      authorityTier: tier.value
    })
    title.value = ''; text.value = ''; url.value = ''
    notify('已加入知识库')
    load()
  } catch (e) {
    notify(String(e.message))
  } finally { saving.value = false }
}

async function search() {
  if (!q.value.trim()) { searchHits.value = []; return }
  try {
    const r = await api.get(`/api/knowledge/search?q=${encodeURIComponent(q.value)}`)
    searchHits.value = r.items || []
  } catch {}
}

async function remove(d) {
  if (!confirm(`删除「${d.title}」？`)) return
  await api.del(`/api/knowledge/${d.id}`)
  load()
}

function tierBadge(t) { return { A: 'green', B: 'blue', C: 'amber', D: 'red', U: 'gray' }[t] || 'gray' }
function fmtK(n) { return n >= 10000 ? (n / 10000).toFixed(1) + '万' : String(n) }

onMounted(load)
</script>

<style scoped>
.kb { max-width: 880px; margin: 0 auto; padding: 30px 24px 60px; }
h1 { font-size: 24px; }
button.on { background: var(--primary); color: #fff; border-color: var(--primary); }
.form { margin-top: 14px; display: flex; flex-direction: column; gap: 12px; }
.field label { margin-bottom: 4px; }

.docs { margin-top: 14px; display: flex; flex-direction: column; }
.doc-row { display: flex; align-items: center; gap: 9px; padding: 9px 0; border-bottom: 1px solid #f1f3f5; font-size: 13.5px; }
.doc-title { font-weight: 600; }

.hits { margin-top: 12px; display: flex; flex-direction: column; gap: 8px; }
.hit { border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; background: var(--panel-2); }
.hit-text { margin-top: 6px; line-height: 1.6; }
.strong { font-weight: 600; }
</style>
