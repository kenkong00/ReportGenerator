import { toHtml } from './html.js'

/**
 * Word 导出：MSO-flavored HTML 存成 .doc。
 * Word 能直接打开并保留标题/表格/样式，零依赖。
 * 若要真 .docx，后续再引 docx 包。
 */
const MSO_PREFIX = `
<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:w="urn:schemas-microsoft-com:office:word"
      xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8">
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]-->
<style>
@page { size: A4; margin: 2cm; }
body { font-family: "Microsoft YaHei", SimSun, serif; font-size: 11pt; line-height: 1.6; }
h1 { font-size: 18pt; }
h2 { font-size: 14pt; color: #1e40af; }
h3 { font-size: 12pt; }
</style></head><body>`

export function toWordHtml(report, project, evidences) {
  const html = toHtml(report, project, evidences, [])
  // 去掉 html.js 自带的完整文档外壳，只保留 body 内容
  const body = html.replace(/^[\s\S]*?<body>/, '').replace(/<\/body>[\s\S]*$/, '')
  return MSO_PREFIX + body + '</body></html>'
}
