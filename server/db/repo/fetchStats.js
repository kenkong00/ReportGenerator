import { run, one, q } from '../index.js'

/** 记录成功 */
export function recordOk(domain) {
  run(`INSERT INTO fetch_domain_stats(domain, consecutive_failures, total_ok, total_fail, last_ok_at, updated_at)
       VALUES (?, 0, 1, 0, datetime('now'), datetime('now'))
       ON CONFLICT(domain) DO UPDATE SET
         consecutive_failures = 0,
         total_ok = total_ok + 1,
         last_ok_at = datetime('now'),
         disabled_until = NULL,
         updated_at = datetime('now')`, domain)
}

/** 记录失败，连续 3 次熔断 10 分钟 */
export function recordFail(domain) {
  const cur = one('SELECT consecutive_failures c FROM fetch_domain_stats WHERE domain = ?', domain)
  const n = (cur?.c || 0) + 1
  const disabled = n >= 3 ? `datetime('now', '+10 minutes')` : 'NULL'
  run(`INSERT INTO fetch_domain_stats(domain, consecutive_failures, total_ok, total_fail, last_fail_at, disabled_until, updated_at)
       VALUES (?, ?, 0, 1, datetime('now'), ${disabled}, datetime('now'))
       ON CONFLICT(domain) DO UPDATE SET
         consecutive_failures = ?,
         total_fail = total_fail + 1,
         last_fail_at = datetime('now'),
         disabled_until = ${disabled},
         updated_at = datetime('now')`, domain, n, n)
}

export function get(domain) {
  return one('SELECT * FROM fetch_domain_stats WHERE domain = ?', domain)
}

export function list() {
  return q('SELECT * FROM fetch_domain_stats ORDER BY total_fail DESC LIMIT 50')
}

export function reset(domain) {
  run(`UPDATE fetch_domain_stats SET consecutive_failures=0, disabled_until=NULL, updated_at=datetime('now') WHERE domain=?`, domain)
}
