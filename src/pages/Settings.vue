<template>
  <div class="settings">
    <h1>设置</h1>

    <!-- LLM -->
    <section class="card pad">
      <h2>大模型通道</h2>
      <p class="small muted">
        系统需要调用大模型来做推理和写作。推荐使用 DeepSeek / 硅基流动 / 阿里通义——它们都兼容 OpenAI 协议，国内直连快，一次深度调研成本大概几毛到一两块钱。
      </p>

      <div class="row prov-row">
        <button class="seg-btn" :class="{ on: form['llm.provider'] === 'compat' }" @click="form['llm.provider'] = 'compat'">
          自填 API（推荐，主力通道）
        </button>
        <button class="seg-btn" :class="{ on: form['llm.provider'] === 'cloud' }" @click="form['llm.provider'] = 'cloud'">
          云端免密钥（备选）
        </button>
      </div>

      <div v-if="form['llm.provider'] === 'compat'" class="form">
        <div class="field">
          <label>接口地址（baseUrl）</label>
          <input v-model="form['llm.compat.baseUrl']" placeholder="https://api.deepseek.com/v1" />
          <div class="tiny muted hints">
            常用：DeepSeek <code>https://api.deepseek.com/v1</code> ·
            硅基流动 <code>https://api.siliconflow.cn/v1</code> ·
            通义 <code>https://dashscope.aliyuncs.com/compatible-mode/v1</code>
          </div>
        </div>
        <div class="field">
          <label>API Key</label>
          <input v-model="form['llm.compat.apiKey']" type="password" placeholder="sk-…" />
        </div>
        <div class="field">
          <label>模型</label>
          <div class="row">
            <input v-model="form['llm.compat.model']" placeholder="deepseek-chat" />
            <button class="sm" @click="loadModels">拉取模型列表</button>
          </div>
          <div v-if="models.length" class="row" style="flex-wrap:wrap;gap:5px;margin-top:6px">
            <button v-for="m in models" :key="m.id" class="sm ghost chip"
              :class="{ on: form['llm.compat.model'] === m.id }" @click="form['llm.compat.model'] = m.id">
              {{ m.id }}
            </button>
          </div>
        </div>
        <div class="field">
          <label>温度（0~1，越低越严谨）</label>
          <input v-model.number="form['llm.compat.temperature']" type="number" step="0.1" min="0" max="1" style="width:120px" />
        </div>

        <div class="field">
          <label class="row" style="gap:8px">
            <input type="checkbox" v-model="form['llm.weakModel']" style="width:auto" />
            轻量模式（本地小模型 / 跑不动时勾选）
          </label>
          <div class="tiny muted hints">
            勾选后：子问题减到 6 个、每节只喂 6 条证据、章节减到 6 节、不写深度版。
            输出更短更快，小模型也能跑完；结论依然带证据标注，只是覆盖面和篇幅会小。
          </div>
        </div>

        <div class="row" style="gap:18px;flex-wrap:wrap">
          <div class="field" style="flex:1;min-width:180px">
            <label>单次请求超时（秒）</label>
            <input v-model.number="timeoutSec" type="number" min="10" step="10" style="width:120px" />
          </div>
          <div class="field" style="flex:1;min-width:180px">
            <label>无新数据判定卡死（秒）</label>
            <input v-model.number="stallSec" type="number" min="10" step="10" style="width:120px" />
          </div>
          <div class="field" style="flex:1;min-width:180px">
            <label>单次输出上限（0=不限）</label>
            <input v-model.number="form['llm.maxOutputTokens']" type="number" min="0" step="256" style="width:120px" />
          </div>
        </div>
        <div class="tiny muted hints">
          「无新数据判定卡死」是给本地模型准备的保险：模型进程崩了但连接没断时，
          靠它发现并自动结束这一步（界面会提示可继续），而不是一直转圈。
        </div>
      </div>

      <div v-else class="form">
        <div v-if="cloudDiag && !cloudDiag.ok" class="notice warn">
          云端通道自检结果：<b>{{ cloudDiag.code }}</b> — {{ cloudDiag.message }}
          <div class="tiny" style="margin-top:6px">
            该通道依赖浏览器 Origin 校验，从 Node 后端调用大概率被拒。若不通，请改用「自填 API」通道，不影响系统使用。
          </div>
        </div>
        <div class="field">
          <label>Endpoint</label>
          <input v-model="form['llm.cloud.endpoint']" placeholder="由云端环境开通后获得" />
        </div>
        <div class="field">
          <label>Publishable Key</label>
          <input v-model="form['llm.cloud.publishableKey']" type="password" />
        </div>
        <div class="field">
          <label>模型 ID</label>
          <input v-model="form['llm.cloud.modelId']" placeholder="留空则自动取列表第一个" />
        </div>
      </div>

      <div class="row" style="margin-top:14px">
        <button class="primary" :disabled="testing" @click="testLlm">
          {{ testing ? '测试中…' : '测试连通性' }}
        </button>
        <button @click="save">保存</button>
        <span class="spacer"></span>
        <span v-if="testResult" class="badge" :class="testResult.ok ? 'green' : 'red'">
          {{ testResult.ok ? '✓ ' : '✗ ' }}{{ testResult.message }}
        </span>
      </div>
    </section>

    <!-- 流水线稳定性 -->
    <section class="card pad">
      <h2>流水线稳定性</h2>
      <p class="small muted">
        调研是长任务，中断很正常（模型服务挂了、机器休眠、网络断了）。
        系统会把每一步的成果落库，中断后点「继续」从断点接着跑，<b>不从头开始</b>。
      </p>
      <div class="form" style="margin-top:12px">
        <div class="field" style="max-width:420px">
          <label>看门狗：多久没动静判定中断（秒）</label>
          <input v-model.number="watchdogSec" type="number" min="30" step="30" style="width:120px" />
          <div class="tiny muted hints">
            超过这个时间流水线没有任何进展，就判定为中断并结束进程，
            界面会显示「继续」按钮。保存后需重启后端生效。
          </div>
        </div>
      </div>
    </section>

    <!-- 检索 -->
    <section class="card pad">
      <h2>联网检索</h2>
      <p class="small muted">
        默认<b>多引擎并行聚合</b>（DuckDuckGo + Bing + 百度/搜狗/360），<b>不需要任何 key</b>。
        不同引擎在本机的可用性差别很大，建议点「测试全部引擎」实测一下，把不通的关掉，只留能用的。
        内容不做预过滤（安全搜索已关闭），尺度由<b>提示词管理 → 内容政策</b>统一控制。
      </p>

      <div class="engines">
        <div class="eng-title small">启用哪些引擎（auto 模式下并行打）</div>
        <label v-for="e in webEngines" :key="e.key" class="eng">
          <input type="checkbox" :checked="engineOn(e.key)" @change="toggleEngine(e.key, $event.target.checked)" />
          <span>{{ e.label }}</span>
          <span class="tiny muted">{{ e.desc }}</span>
        </label>
      </div>

      <div class="row" style="margin-top:12px; flex-wrap:wrap; gap:14px">
        <label class="inline-toggle">
          <input type="checkbox" v-model="enableFetch" /> 抓取正文（关掉就只用搜索摘要，证据会少、容易"未找到"）
        </label>
        <label class="inline-toggle">
          <input type="checkbox" v-model="relevanceGate" /> 相关性闸门（剔除词典站/ChatGPT 等与话题无关的填充结果，强烈建议开）
        </label>
      </div>

      <div class="row" style="margin-top:12px; flex-wrap:wrap; gap:14px">
        <div class="field" style="max-width:150px">
          <label>每域名最多几条</label>
          <input v-model.number="perDomainCap" type="number" min="1" max="20" style="width:90px" />
        </div>
        <div class="field" style="max-width:150px">
          <label>代理模式</label>
          <select v-model="proxyMode" style="width:110px">
            <option value="off">关闭</option>
            <option value="auto">自动</option>
            <option value="on">启用</option>
          </select>
        </div>
        <div class="field" style="flex:1; min-width:220px">
          <label>代理地址（部分网络下国内站点需要）</label>
          <input v-model="proxyUrl" placeholder="http://127.0.0.1:7890" />
        </div>
      </div>

      <div class="row" style="margin-top:14px">
        <button :disabled="testingSearch" @click="testSearch">
          {{ testingSearch ? '测试中…' : '测试全部引擎' }}
        </button>
        <span class="small muted">用「比亚迪 刀片电池」逐个实测，看清哪家在你本机可用</span>
      </div>

      <div v-if="engineResults.length" class="sample">
        <div v-for="r in engineResults" :key="r.engine" class="eng-res">
          <span class="badge" :class="r.ok ? 'green' : 'red'">{{ r.ok ? '✓' : '✗' }}</span>
          <b style="min-width:90px">{{ r.engine }}</b>
          <span class="tiny muted">{{ r.count }} 条 · {{ r.latencyMs }}ms</span>
          <span class="tiny muted ellipsis">{{ (r.domains || []).join(', ') || r.error || '' }}</span>
        </div>
      </div>
    </section>

    <!-- 域名权威 -->
    <section class="card pad">
      <h2>来源权威规则</h2>
      <p class="small muted">
        系统内置了 {{ domainCount }} 条域名权威画像。评估来源时按此分级，你也可以覆盖任何一条。
      </p>
      <div class="tiers">
        <div class="tier-row"><span class="badge green">A</span> 一手权威：政府/统计/监管/交易所/上市公司披露/同行评议论文</div>
        <div class="tier-row"><span class="badge blue">B</span> 专业二手：主流财经媒体、券商研报、行业媒体、行业协会</div>
        <div class="tier-row"><span class="badge amber">C</span> 需交叉验证：百科、社区、自媒体深度文</div>
        <div class="tier-row"><span class="badge gray">U</span> 未知域名：按 C 处理并在报告里标注</div>
        <div class="tier-row"><span class="badge red">D</span> 基本不用：论坛灌水、营销号、无署名站点</div>
      </div>
      <div class="small muted" style="margin-top:12px">
        <b>置信度规则</b>（规则算的值权威，模型只能建议降级，不能抬高）：
        ≥2 个独立 A 级来源一致 → 高；单一 A 级或 ≥2 个 B 级 → 中；单一 B 级或 ≥2 个 C 级 → 低；
        来源冲突无权威裁决 / 只有 C 级 / 纯推断 → 存疑（并强制标注"这是推理不是事实"）。
      </div>
    </section>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { api, notify } from '../api'

const form = reactive({})
const models = ref([])
const testing = ref(false)
const testResult = ref(null)
const testingSearch = ref(false)
const engineResults = ref([])
const domainCount = ref(0)
const cloudDiag = ref(null)

// 联网检索相关（从 form 派生，保存时回填）
const webEngines = [
  { key: 'duckduckgo', label: 'DuckDuckGo', desc: '零 key，通用网页' },
  { key: 'bing', label: 'Bing', desc: '零 key，中文结果好' },
  { key: 'baidu', label: '百度', desc: '零 key，国内内容多' },
  { key: 'sogou', label: '搜狗', desc: '零 key，含微信生态' },
  { key: 'so360', label: '360', desc: '零 key' },
  { key: 'bing-rss', label: 'Bing RSS', desc: '旧通道，多已失效' }
]
const engineList = ref(['duckduckgo', 'bing', 'baidu', 'sogou', 'so360'])
const enableFetch = ref(true)
const perDomainCap = ref(3)
const relevanceGate = ref(true)
const proxyMode = ref('off')
const proxyUrl = ref('')

function engineOn(k) { return engineList.value.includes(k) }
function toggleEngine(k, on) {
  if (on) { if (!engineList.value.includes(k)) engineList.value.push(k) }
  else engineList.value = engineList.value.filter(x => x !== k)
}

function pullSearch() {
  engineList.value = Array.isArray(form['search.engines']) && form['search.engines'].length
    ? [...form['search.engines']]
    : ['duckduckgo', 'bing', 'baidu', 'sogou', 'so360']
  enableFetch.value = form['pipeline.enableFetch'] !== false
  perDomainCap.value = Number(form['search.perDomainCap']) || 3
  relevanceGate.value = form['search.relevanceGate'] !== false
  proxyMode.value = form['proxy.mode'] || 'off'
  proxyUrl.value = form['proxy.url'] || ''
}
function pushSearch() {
  form['search.engines'] = [...engineList.value]
  form['pipeline.enableFetch'] = enableFetch.value
  form['search.perDomainCap'] = Number(perDomainCap.value) || 3
  form['search.relevanceGate'] = relevanceGate.value
  form['proxy.mode'] = proxyMode.value
  form['proxy.url'] = proxyUrl.value
}

// 秒 ↔ 毫秒 转换（设置里按秒填，库里存毫秒）
const timeoutSec = ref(180)
const stallSec = ref(90)
const watchdogSec = ref(180)

function pullSeconds() {
  timeoutSec.value = Math.round((Number(form['llm.compat.timeoutMs']) || 180000) / 1000)
  stallSec.value = Math.round((Number(form['llm.compat.stallMs']) || 90000) / 1000)
  watchdogSec.value = Math.round((Number(form['pipeline.stallMs']) || 180000) / 1000)
}

function pushSeconds() {
  form['llm.compat.timeoutMs'] = Math.max(10, timeoutSec.value) * 1000
  form['llm.compat.stallMs'] = Math.max(10, stallSec.value) * 1000
  form['pipeline.stallMs'] = Math.max(30, watchdogSec.value) * 1000
}

async function load() {
  try {
    const r = await api.get('/api/settings')
    Object.assign(form, r.settings || {})
    pullSeconds()
    pullSearch()
    domainCount.value = r.domainProfileCount || 0
    cloudDiag.value = form['diag.cloudLlm'] || null
  } catch {}
}

async function save() {
  pushSeconds()
  pushSearch()
  const payload = { ...form }
  delete payload['diag.cloudLlm']
  await api.put('/api/settings', payload)
  notify('已保存')
  await load()
}

async function testLlm() {
  testing.value = true
  testResult.value = null
  try {
    await save()
    const r = await api.post('/api/settings/test-llm', { provider: form['llm.provider'] })
    testResult.value = r.result
    if (r.result?.models?.length) models.value = r.result.models
    await load()
  } catch (e) {
    testResult.value = { ok: false, message: String(e.message) }
  } finally { testing.value = false }
}

async function loadModels() {
  try {
    const r = await api.get('/api/models?provider=compat')
    models.value = r.models || []
    if (!models.value.length) notify('未能拉取模型列表，请检查 baseUrl 和 Key')
  } catch {}
}

async function testSearch() {
  testingSearch.value = true
  engineResults.value = []
  try {
    await save() // 先保存引擎/代理配置，再测试，保证测的是当前设置
    const r = await api.post('/api/settings/test-search', { query: '比亚迪 刀片电池 技术' })
    // 只展示当前勾选的引擎
    engineResults.value = (r.results || []).filter(x => engineList.value.includes(x.engine))
    const ok = engineResults.value.filter(x => x.ok).length
    notify(`测试完成：${ok}/${engineResults.value.length} 个引擎可用`, ok ? 'ok' : 'err')
  } catch (e) {
    notify(String(e.message))
  } finally { testingSearch.value = false }
}

onMounted(load)
</script>

<style scoped>
.settings { max-width: 820px; margin: 0 auto; padding: 30px 24px 60px; display: flex; flex-direction: column; gap: 16px; }
h1 { font-size: 24px; margin-bottom: 4px; }
.card h2 { font-size: 17px; }

.prov-row { gap: 0; border: 1px solid var(--border-strong); border-radius: 7px; overflow: hidden; margin: 12px 0; width: fit-content; }
.seg-btn { border: none; border-radius: 0; padding: 8px 18px; }
.seg-btn + .seg-btn { border-left: 1px solid var(--border); }
.seg-btn.on { background: var(--primary); color: #fff; font-weight: 600; }

.form { display: flex; flex-direction: column; gap: 14px; }
.field label { margin-bottom: 4px; }
.hints { margin-top: 5px; }
.hints code { margin: 0 2px; }

.chip { border: 1px solid var(--border); border-radius: 20px; }

.engines { margin-top: 12px; background: var(--panel-2); border: 1px solid var(--border); border-radius: 8px; padding: 12px 14px; }
.eng-title { font-weight: 650; color: var(--text-2); margin-bottom: 8px; }
.eng { display: flex; align-items: center; gap: 8px; font-weight: 500; margin-bottom: 5px; }
.eng input { width: auto; }
.eng span:first-of-type { min-width: 100px; font-weight: 600; }
.inline-toggle { display: flex; align-items: center; gap: 7px; font-size: 13px; font-weight: 500; color: var(--text-2); }
.inline-toggle input { width: auto; }
.sample { margin-top: 10px; display: flex; flex-direction: column; gap: 5px; }
.eng-res { display: flex; align-items: center; gap: 10px; font-size: 12.5px; }
.ellipsis { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chip.on { background: var(--primary-soft); border-color: var(--primary); color: var(--primary); font-weight: 600; }

.notice { padding: 11px 14px; border-radius: 7px; font-size: 13px; margin-bottom: 4px; }
.notice.warn { background: var(--warn-bg); border: 1px solid #fcd9a4; color: #78350f; }

.sample { margin-top: 10px; padding: 10px 12px; background: var(--panel-2); border-radius: 6px; }
.tiers { margin-top: 12px; display: flex; flex-direction: column; gap: 7px; }
.tier-row { display: flex; align-items: center; gap: 9px; font-size: 13px; }
</style>
