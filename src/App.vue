<template>
  <div class="app">
    <aside class="sidebar">
      <div class="brand">
        <div class="logo">深</div>
        <div>
          <div class="brand-title">深度调研</div>
          <div class="brand-sub">报告生成器</div>
        </div>
      </div>

      <nav>
        <router-link to="/" class="nav-item">
          <span class="ico">＋</span> 新建调研
        </router-link>
        <router-link to="/knowledge" class="nav-item">
          <span class="ico">◫</span> 知识库
        </router-link>
        <router-link to="/prompts" class="nav-item">
          <span class="ico">✎</span> 提示词管理
        </router-link>
        <router-link to="/settings" class="nav-item">
          <span class="ico">⚙</span> 设置
        </router-link>
      </nav>

      <div v-if="recent.length" class="recent">
        <div class="recent-title">最近调研</div>
        <router-link
          v-for="p in recent" :key="p.id"
          :to="p.status === 'done' ? `/report/${p.id}` : `/live/${p.id}`"
          class="recent-item"
        >
          <span class="dot" :class="dotClass(p.status)"></span>
          <span class="ellipsis">{{ p.title }}</span>
        </router-link>
      </div>

      <div class="side-foot">
        <div class="tiny muted">后端 5210 · 前端 5209</div>
      </div>
    </aside>

    <main class="main">
      <router-view />
    </main>

    <div v-if="toast" class="toast">{{ toast }}</div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { api } from './api'

const recent = ref([])
const toast = ref('')
let toastTimer = null

function onToast(e) {
  toast.value = e.detail || ''
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { toast.value = '' }, 3600)
}

async function load() {
  try {
    const r = await api.get('/api/projects?limit=12')
    recent.value = r.items || []
  } catch {}
}

function dotClass(s) {
  return { done: 'ok', running: 'run', failed: 'err', paused: 'warn' }[s] || 'idle'
}

onMounted(() => {
  load()
  window.addEventListener('project-changed', load)
  window.addEventListener('toast', onToast)
})
</script>

<style scoped>
.app { display: flex; height: 100%; }

.sidebar {
  width: 232px; flex: 0 0 232px;
  background: var(--panel); border-right: 1px solid var(--border);
  display: flex; flex-direction: column; padding: 16px 12px; gap: 16px;
}

.brand { display: flex; gap: 10px; align-items: center; padding: 4px 6px; }
.logo {
  width: 32px; height: 32px; border-radius: 8px; flex: 0 0 32px;
  background: var(--primary); color: #fff; font-weight: 800; font-size: 15px;
  display: flex; align-items: center; justify-content: center;
}
.brand-title { font-weight: 700; font-size: 14px; line-height: 1.2; }
.brand-sub { font-size: 11px; color: var(--text-3); }

nav { display: flex; flex-direction: column; gap: 2px; }
.nav-item {
  display: flex; align-items: center; gap: 9px;
  padding: 8px 10px; border-radius: 7px; font-size: 13.5px;
  color: var(--text-2); font-weight: 500;
}
.nav-item:hover { background: var(--panel-2); text-decoration: none; }
.nav-item.router-link-exact-active { background: var(--primary-soft); color: var(--primary); font-weight: 600; }
.ico { width: 16px; text-align: center; opacity: .8; }

.recent { flex: 1; overflow-y: auto; border-top: 1px solid var(--border); padding-top: 12px; }
.recent-title { font-size: 11px; font-weight: 700; color: var(--text-3); padding: 0 8px 6px; letter-spacing: .04em; }
.recent-item {
  display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 6px;
  font-size: 12.5px; color: var(--text-2);
}
.recent-item:hover { background: var(--panel-2); text-decoration: none; }
.ellipsis { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dot { width: 6px; height: 6px; border-radius: 50%; flex: 0 0 6px; background: var(--border-strong); }
.dot.ok { background: var(--ok); }
.dot.run { background: var(--primary); animation: pulse 1.2s infinite; }
.dot.err { background: var(--danger); }
.dot.warn { background: var(--warn); }
@keyframes pulse { 0%,100% { opacity: 1 } 50% { opacity: .35 } }

.side-foot { border-top: 1px solid var(--border); padding-top: 10px; }

.main { flex: 1; min-width: 0; overflow-y: auto; }

.toast {
  position: fixed; left: 50%; bottom: 28px; transform: translateX(-50%);
  background: #1a1d21; color: #fff; padding: 11px 20px; border-radius: 8px;
  font-size: 13px; box-shadow: var(--shadow-md); z-index: 999; max-width: 70vw;
  animation: rise .2s ease;
}
@keyframes rise { from { opacity: 0; transform: translate(-50%, 8px) } to { opacity: 1; transform: translate(-50%, 0) } }
</style>
