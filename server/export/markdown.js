import { j } from '../utils/text.js'

/** Markdown 导出：正文 + 来源附录（把 [[ev:n]] 换成脚注式编号） */
export function toMarkdown(report, project, evidences) {
  const evMap = new Map(evidences.map(e => [e.id, e]))
  const used = new Map()

  let footnote = 1
  const body = (report.md || '').replace(/\[\[ev:(\d+)\]\]/g, (full, id) => {
    const e = evMap.get(Number(id))
    if (!e) return '[^?]'
    if (!used.has(Number(id))) used.set(Number(id), footnote++)
    return `[^${used.get(Number(id))}]`
  })

  const lines = [
    `# ${report.title || project.title}`,
    '',
    `> 生成时间：${report.created_at}　|　档位：${{ brief: '速览', standard: '标准', deep: '深度' }[report.variant] || report.variant}`,
    ''
  ]
  if (report.offline_notice) lines.push(`> ⚠️ ${report.offline_notice}`, '')

  lines.push('---', '', body, '', '---', '', '## 引用来源', '')

  for (const [id, n] of [...used.entries()].sort((a, b) => a[1] - b[1])) {
    const e = evMap.get(id)
    if (!e) continue
    const data = j(e.data_json, [])
    lines.push(
      `[^${n}]: ${e.claim}`,
      `　来源：${e.source_title || e.domain}（${e.source_url || ''}）　权威等级：${e.authority_tier || 'U'}　置信度：${e.confidence}` +
      (data?.length ? `\n　数据点：${data.map(d => `${d.label}=${d.value}${d.unit || ''}@${d.asOf || '?'}`).join('；')}` : '') +
      (e.inference ? `\n　⚠️ 这是推断，推理链条：${e.inference_chain || '未记录'}` : ''),
      ''
    )
  }

  const quality = j(report.quality_json, {})
  if (quality.issueCount) {
    lines.push('---', '', '## 自审提示', '', `本次自审发现 ${quality.issueCount} 处问题，未挂证据的断言句比例约 ${((quality.uncoveredClaimRatio || 0) * 100).toFixed(0)}%。`, '')
  }

  return lines.join('\n')
}
