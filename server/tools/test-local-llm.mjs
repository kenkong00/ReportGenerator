// 实测：jsonMode 下对 LM Studio 的自动降级重试
import { OpenAICompatProvider } from '../llm/providers/openai-compat.js'

const p = new OpenAICompatProvider({
  baseUrl: 'http://127.0.0.1:1234/v1',
  apiKey: 'lm-studio',
  model: process.argv[2] || 'gemma-4-e4b',
  temperature: 0.3
})

console.log('model =', p.model)
const t0 = Date.now()
try {
  const r = await p.chat(
    [
      { role: 'system', content: '你是信息抽取引擎。只输出 JSON，不要输出任何其他文字。' },
      { role: 'user', content: '把下面这句话拆成 JSON：{"topic": "...", "angle": "..."}。句子：比亚迪的刀片电池技术领先同行' }
    ],
    { jsonMode: true, maxTokens: 300 }
  )
  console.log('OK  耗时', Date.now() - t0, 'ms')
  console.log('finishReason =', r.finishReason)
  console.log('content =', JSON.stringify(r.content.slice(0, 300)))
  console.log('supportsJsonObject() 之后 =', p.supportsJsonObject(), '（false = 已记住该后端不支持，后续不再发）')
} catch (e) {
  console.log('FAIL', Date.now() - t0, 'ms:', e.name, e.message)
}
