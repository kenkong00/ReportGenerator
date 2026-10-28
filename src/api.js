const BASE = '/api'

function notify(msg) {
  window.dispatchEvent(new CustomEvent('toast', { detail: msg }))
}

async function request(path, options = {}) {
  const url = path.startsWith('/api') ? path : BASE + path
  let res
  try {
    res = await fetch(url, {
      headers: { 'Content-Type': 'application/json' },
      ...options
    })
  } catch (e) {
    notify(`网络错误：${e.message}`)
    throw e
  }
  let data
  const ct = res.headers.get('content-type') || ''
  if (ct.includes('json')) {
    data = await res.json()
  } else {
    data = { ok: res.ok, text: await res.text() }
  }
  if (!res.ok || data.ok === false) {
    const msg = data.error || data.message || `请求失败（${res.status}）`
    notify(msg)
    throw new Error(msg)
  }
  return data
}

export const api = {
  get: (p) => request(p),
  post: (p, body) => request(p, { method: 'POST', body: JSON.stringify(body || {}) }),
  put: (p, body) => request(p, { method: 'PUT', body: JSON.stringify(body || {}) }),
  patch: (p, body) => request(p, { method: 'PATCH', body: JSON.stringify(body || {}) }),
  del: (p) => request(p, { method: 'DELETE' }),
  raw: request
}

/** SSE 订阅：自动重连 + Last-Event-ID 续拉 */
export function subscribeEvents(runId, onEvent, { onOpen, onError } = {}) {
  let es = null
  let lastSeq = Number(localStorage.getItem(`seq:${runId}`) || 0)
  let closed = false
  let retry = 0

  function open() {
    if (closed) return
    const url = `${BASE}/runs/${runId}/events?lastSeq=${lastSeq}`
    es = new EventSource(url)

    es.onopen = () => { retry = 0; onOpen?.() }

    es.onmessage = (e) => {
      // 默认事件（无 event: 字段）
      handle(e)
    }

    es.onerror = () => {
      onError?.()
      es.close()
      if (closed) return
      retry++
      const delay = Math.min(1000 * Math.pow(1.6, retry), 10000)
      setTimeout(open, delay)
    }

    // 逐个注册事件类型
    for (const t of EVENT_TYPES) {
      es.addEventListener(t, handle)
    }
  }

  function handle(e) {
    let payload = {}
    try { payload = JSON.parse(e.data) } catch {}
    if (e.lastEventId) {
      lastSeq = Math.max(lastSeq, Number(e.lastEventId))
      localStorage.setItem(`seq:${runId}`, String(lastSeq))
    }
    onEvent({ type: e.type, payload, seq: lastSeq })
  }

  open()
  return () => { closed = true; es?.close() }
}

const EVENT_TYPES = [
  'run.start', 'run.done', 'run.failed', 'run.paused',
  'stage.start', 'stage.progress', 'stage.think', 'stage.chunk',
  'stage.done', 'stage.error', 'stage.retry', 'stage.skip',
  'budget.warn', 'budget.hit', 'heartbeat'
]

export { notify }
