/**
 * 提示词模板仓库。
 * 全部提示词存 DB，运行时可读可改；出厂默认来自 prompts/defaults.js。
 */
import { q, one, run } from '../index.js'
import { DEFAULT_TEMPLATES } from '../../prompts/defaults.js'

/** 首次启动把出厂默认写入 DB（已存在的不覆盖用户改动，但会同步未被改动的内置模板） */
export function seed() {
  let inserted = 0
  DEFAULT_TEMPLATES.forEach((t, i) => {
    const row = one('SELECT key, template, builtin, is_builtin FROM prompt_templates WHERE key = ?', t.key)
    if (row) {
      if (row.is_builtin) {
        // 内置模板：用户没改过（template === builtin）→ 跟随代码默认一起升级；
        // 用户改过 → 保留用户的 template，只把 builtin 更新为新默认（"恢复默认"即回到新版）。
        const userModified = row.template !== row.builtin
        run(
          `UPDATE prompt_templates SET name=?, category=?, stage_key=?, description=?, variables=?, ord=?,
             builtin=?, template=? WHERE key=?`,
          t.name, t.category, t.stageKey || null, t.description || '',
          JSON.stringify(t.variables || []), i,
          t.template, userModified ? row.template : t.template, t.key
        )
      } else {
        run(
          `UPDATE prompt_templates SET name=?, category=?, stage_key=?, description=?, variables=?, ord=?
           WHERE key=?`,
          t.name, t.category, t.stageKey || null, t.description || '',
          JSON.stringify(t.variables || []), i, t.key
        )
      }
      return
    }
    run(
      `INSERT INTO prompt_templates(key, name, category, stage_key, description, template, builtin, variables, enabled, is_builtin, ord)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?)`,
      t.key, t.name, t.category, t.stageKey || null, t.description || '',
      t.template, t.template, JSON.stringify(t.variables || []), i
    )
    inserted++
  })
  return inserted
}

/** 播种 schema.* 模板（文本由 schemas.js 生成后传入，避免 repo 反向依赖 schemas 造成循环） */
export function seedSchemas(map = {}) {
  let n = 0
  for (const [key, text] of Object.entries(map)) {
    if (!text) continue
    const row = one('SELECT template, builtin, is_builtin FROM prompt_templates WHERE key = ?', key)
    if (row) {
      // 与 seed() 同策略：内置且用户没改过 → 跟随代码升级；改过则只更新 builtin
      if (row.is_builtin) {
        const userModified = row.template !== row.builtin
        run(
          `UPDATE prompt_templates SET builtin=?, template=? WHERE key=?`,
          text, userModified ? row.template : text, key
        )
      }
      continue
    }
    const name = '输出结构 · ' + key.replace('schema.', '')
    run(
      `INSERT INTO prompt_templates(key, name, category, stage_key, description, template, builtin, variables, enabled, is_builtin, ord)
       VALUES (?, ?, 'schema', NULL, ?, ?, ?, '[]', 1, 1, 900)`,
      key, name, '本步骤要求模型输出的 JSON 结构说明。改坏了会导致解析失败，谨慎修改。', text, text
    )
    n++
  }
  return n
}

function parse(row) {
  if (!row) return null
  let variables = []
  try { variables = JSON.parse(row.variables || '[]') } catch {}
  return {
    key: row.key,
    name: row.name,
    category: row.category,
    stageKey: row.stage_key,
    description: row.description,
    template: row.template,
    builtin: row.builtin,
    variables,
    enabled: !!row.enabled,
    isBuiltin: !!row.is_builtin,
    ord: row.ord,
    updatedAt: row.updated_at,
    isModified: row.template !== row.builtin
  }
}

export function list(category = null) {
  const rows = category
    ? q('SELECT * FROM prompt_templates WHERE category = ? ORDER BY ord, key', category)
    : q('SELECT * FROM prompt_templates ORDER BY ord, key')
  return rows.map(parse)
}

export function get(key) {
  return parse(one('SELECT * FROM prompt_templates WHERE key = ?', key))
}

/** 运行时取「生效模板文本」。停用 → 用出厂默认；不存在 → null（由调用方兜底） */
export function effective(key) {
  const row = get(key)
  if (!row) return null
  return row.enabled ? row.template : row.builtin
}

/** 保存（只允许改 template / name / description / enabled） */
export function update(key, patch = {}) {
  const cur = get(key)
  if (!cur) return false
  const t = patch.template ?? cur.template
  const name = patch.name ?? cur.name
  const description = patch.description ?? cur.description
  const enabled = patch.enabled === undefined ? (cur.enabled ? 1 : 0) : (patch.enabled ? 1 : 0)
  run(
    `UPDATE prompt_templates SET template=?, name=?, description=?, enabled=?, updated_at=datetime('now') WHERE key=?`,
    t, name, description, enabled, key
  )
  return true
}

/** 恢复出厂默认 */
export function reset(key) {
  const cur = get(key)
  if (!cur) return false
  run(`UPDATE prompt_templates SET template=builtin, enabled=1, updated_at=datetime('now') WHERE key=?`, key)
  return true
}

/** 恢复全部内置项为出厂默认 */
export function resetAll() {
  run(`UPDATE prompt_templates SET template=builtin, enabled=1, updated_at=datetime('now') WHERE is_builtin=1`)
  return true
}

/** 用户新建自定义提示词 */
export function createCustom({ key, name, category = 'custom', description = '', template = '' }) {
  if (!key || !name) throw new Error('key 与 name 必填')
  if (one('SELECT key FROM prompt_templates WHERE key = ?', key)) throw new Error('key 已存在：' + key)
  const maxOrd = one('SELECT MAX(ord) m FROM prompt_templates')?.m ?? 999
  run(
    `INSERT INTO prompt_templates(key, name, category, stage_key, description, template, builtin, variables, enabled, is_builtin, ord)
     VALUES (?, ?, ?, NULL, ?, ?, '', '[]', 1, 0, ?)`,
    key, name, category, description, template, maxOrd + 1
  )
  return get(key)
}

/** 删除（仅允许用户自建项） */
export function remove(key) {
  const cur = get(key)
  if (!cur) return false
  if (cur.isBuiltin) throw new Error('内置提示词不可删除，只能修改或重置')
  run('DELETE FROM prompt_templates WHERE key = ?', key)
  return true
}

/** 导出全部（给前端一键备份） */
export function exportAll() {
  return list().map(x => ({ key: x.key, name: x.name, template: x.template, enabled: x.enabled }))
}

export function importAll(items = []) {
  let n = 0
  for (const it of items) {
    if (!it?.key || typeof it.template !== 'string') continue
    if (get(it.key)) { update(it.key, { template: it.template, enabled: it.enabled }); n++ }
  }
  return n
}

export function count() {
  return one('SELECT COUNT(*) c FROM prompt_templates')?.c || 0
}
