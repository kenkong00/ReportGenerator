/** 自写并发池 + 退避重试（不引第三方） */

export function pLimit(n) {
  let active = 0
  const queue = []
  const next = () => {
    if (active >= n || queue.length === 0) return
    active++
    const { fn, resolve, reject } = queue.shift()
    fn().then(resolve, reject).finally(() => {
      active--
      next()
    })
  }
  return (fn) => new Promise((resolve, reject) => {
    queue.push({ fn, resolve, reject })
    next()
  })
}

export function sleep(ms) {
  return new Promise(r => setTimeout(r, ms))
}

/**
 * 退避重试
 * @param {Object} opts
 * @param {number} opts.retries 最大重试次数
 * @param {number[]} opts.delays 每次重试前的延迟（ms）
 * @param {(e:Error, attempt:number)=>boolean} opts.shouldRetry 返回 false 立即放弃
 */
export async function withRetry(fn, { retries = 3, delays = [1000, 3000, 8000], shouldRetry = () => true, onRetry = () => {} } = {}) {
  let lastErr
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn(attempt)
    } catch (e) {
      lastErr = e
      if (attempt >= retries || !shouldRetry(e, attempt)) throw e
      const d = delays[Math.min(attempt, delays.length - 1)]
      onRetry(e, attempt, d)
      await sleep(d)
    }
  }
  throw lastErr
}

/** 令牌桶限流 */
export function rateLimiter({ maxPerMinute = 20 } = {}) {
  let tokens = maxPerMinute
  let last = Date.now()
  return async function acquire() {
    const now = Date.now()
    tokens = Math.min(maxPerMinute, tokens + ((now - last) / 60000) * maxPerMinute)
    last = now
    if (tokens < 1) {
      const wait = ((1 - tokens) / maxPerMinute) * 60000
      await sleep(Math.ceil(wait))
      tokens = 0
    } else {
      tokens -= 1
    }
  }
}

/** 带超时的 Promise */
export function withTimeout(promise, ms, label = 'operation') {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} 超时（${ms}ms）`)), ms)
    promise.then(
      (v) => { clearTimeout(t); resolve(v) },
      (e) => { clearTimeout(t); reject(e) }
    )
  })
}

/** 顺序处理，但保留索引 */
export async function mapLimit(items, limit, fn) {
  const lim = pLimit(limit)
  return Promise.all(items.map((it, i) => lim(() => fn(it, i))))
}
