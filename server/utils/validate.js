/** 轻量 JSON Schema 校验器（不引 zod/joi） */

/**
 * schema 形状：
 * {
 *   type: 'object'|'array',
 *   required: ['a','b'],
 *   properties: { a: {type:'string'}, b: {type:'array', items:{...}} },
 *   items: {...},              // type=array 时
 *   enum: [...],               // 可选
 *   minItems / maxItems
 * }
 * @returns {string[]} 错误描述数组，空数组表示通过
 */
export function validate(value, schema, path = '$') {
  const errs = []
  if (!schema) return errs

  if (schema.enum && !schema.enum.includes(value)) {
    errs.push(`${path}: 值 ${JSON.stringify(value)} 不在允许范围 [${schema.enum.join('|')}]`)
    return errs
  }

  const t = schema.type
  if (t === 'object') {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      errs.push(`${path}: 应为对象，实际为 ${Array.isArray(value) ? 'array' : typeof value}`)
      return errs
    }
    for (const k of schema.required || []) {
      if (!(k in value) || value[k] === null || value[k] === undefined) {
        errs.push(`${path}.${k}: 必填字段缺失`)
      }
    }
    for (const [k, v] of Object.entries(value)) {
      const sub = schema.properties?.[k]
      if (sub) errs.push(...validate(v, sub, `${path}.${k}`))
      else if (schema.additionalProperties === false) errs.push(`${path}.${k}: 不允许的字段`)
    }
  } else if (t === 'array') {
    if (!Array.isArray(value)) {
      errs.push(`${path}: 应为数组，实际为 ${typeof value}`)
      return errs
    }
    if (schema.minItems != null && value.length < schema.minItems) {
      errs.push(`${path}: 至少需要 ${schema.minItems} 项，实际 ${value.length} 项`)
    }
    if (schema.maxItems != null && value.length > schema.maxItems) {
      errs.push(`${path}: 最多 ${schema.maxItems} 项，实际 ${value.length} 项`)
    }
    if (schema.items) {
      value.forEach((v, i) => errs.push(...validate(v, schema.items, `${path}[${i}]`)))
    }
  } else if (t === 'string') {
    if (typeof value !== 'string') errs.push(`${path}: 应为字符串，实际为 ${typeof value}`)
  } else if (t === 'number') {
    if (typeof value !== 'number') errs.push(`${path}: 应为数字，实际为 ${typeof value}`)
  } else if (t === 'boolean') {
    if (typeof value !== 'boolean') errs.push(`${path}: 应为布尔值，实际为 ${typeof value}`)
  }
  return errs
}

/**
 * 宽松修正：把常见的小毛病修掉（枚举大小写、字符串数字、缺失的数组）
 * 只做安全修正，不做臆测填充。
 */
export function coerce(value, schema) {
  if (!schema || value == null) return value
  if (schema.type === 'array' && !Array.isArray(value)) {
    if (typeof value === 'object') return Object.values(value)
    if (typeof value === 'string') return [value]
  }
  if (schema.type === 'string' && typeof value === 'number') return String(value)
  if (schema.type === 'number' && typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value.trim())) {
    return Number(value.trim())
  }
  if (schema.enum && typeof value === 'string') {
    const hit = schema.enum.find(e => String(e).toLowerCase() === value.toLowerCase())
    if (hit) return hit
  }
  if (schema.type === 'object' && schema.properties && typeof value === 'object' && !Array.isArray(value)) {
    for (const [k, sub] of Object.entries(schema.properties)) {
      if (value[k] !== undefined) value[k] = coerce(value[k], sub)
    }
  }
  if (schema.type === 'array' && Array.isArray(value) && schema.items?.properties) {
    value.forEach(v => coerce(v, schema.items))
  }
  return value
}
