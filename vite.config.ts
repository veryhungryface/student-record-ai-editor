import type { IncomingMessage, ServerResponse } from 'node:http'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const OPENAI_MODEL = 'gpt-5.4-nano'

type OpenAIResponse = {
  output_text?: unknown
  output?: Array<{
    content?: Array<{
      text?: unknown
    }>
  }>
}

function sendJson(res: ServerResponse, statusCode: number, payload: unknown) {
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(payload))
}

function readJsonBody(req: IncomingMessage) {
  return new Promise<unknown>((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8')
        resolve(raw ? JSON.parse(raw) : {})
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

function getResponseText(data: OpenAIResponse) {
  if (typeof data.output_text === 'string' && data.output_text.trim()) {
    return data.output_text.trim()
  }

  for (const item of data.output ?? []) {
    const content = item.content?.find((contentItem) => typeof contentItem.text === 'string' && contentItem.text.trim())
    if (typeof content?.text === 'string') return content.text.trim()
  }

  return ''
}

function localReviseApiPlugin(apiKey?: string): Plugin {
  return {
    name: 'local-revise-api',
    configureServer(server) {
      server.middlewares.use('/api/revise', async (req, res) => {
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: 'POST만 허용됩니다.' })
          return
        }

        if (!apiKey) {
          sendJson(res, 500, { error: '로컬 .env.local에 OPENAI_API_KEY가 설정되지 않았습니다.' })
          return
        }

        try {
          const body = await readJsonBody(req)
          const prompt = body && typeof body === 'object' && 'prompt' in body ? (body as { prompt?: unknown }).prompt : undefined
          if (!prompt || typeof prompt !== 'string') {
            sendJson(res, 400, { error: 'prompt가 필요합니다.' })
            return
          }

          const response = await fetch('https://api.openai.com/v1/responses', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
              model: OPENAI_MODEL,
              input: prompt,
              temperature: 0.35,
              max_output_tokens: 220,
            }),
          })

          if (!response.ok) {
            const text = await response.text()
            sendJson(res, response.status, { error: text || `OpenAI 오류: ${response.status}` })
            return
          }

          const data = await response.json() as OpenAIResponse
          const text = getResponseText(data)
          if (!text) {
            sendJson(res, 502, { error: 'AI 응답에서 문구를 찾지 못했습니다.' })
            return
          }

          sendJson(res, 200, { text })
        } catch (error) {
          sendJson(res, 500, { error: String(error instanceof Error ? error.message : error) })
        }
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    base: '/',
    plugins: [react(), localReviseApiPlugin(env.OPENAI_API_KEY || process.env.OPENAI_API_KEY)],
  }
})
