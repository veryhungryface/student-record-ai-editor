// Vercel 서버리스 함수: OpenAI 호출 대행 (키는 서버 환경변수에만 보관)
const OPENAI_MODEL = 'gpt-5.4-nano'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST만 허용됩니다.' })
    return
  }

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    res.status(500).json({ error: '서버에 OPENAI_API_KEY가 설정되지 않았습니다.' })
    return
  }

  try {
    const prompt = req.body && req.body.prompt
    if (!prompt || typeof prompt !== 'string') {
      res.status(400).json({ error: 'prompt가 필요합니다.' })
      return
    }

    const r = await fetch('https://api.openai.com/v1/responses', {
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

    if (!r.ok) {
      const t = await r.text()
      res.status(r.status).json({ error: t || `OpenAI 오류: ${r.status}` })
      return
    }

    const data = await r.json()
    let text = ''
    if (typeof data.output_text === 'string' && data.output_text.trim()) {
      text = data.output_text.trim()
    } else {
      const content = data.output?.[0]?.content?.find((i) => i.text)?.text
      if (typeof content === 'string') text = content.trim()
    }

    if (!text) {
      res.status(502).json({ error: 'AI 응답에서 문구를 찾지 못했습니다.' })
      return
    }
    res.status(200).json({ text })
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) })
  }
}
