/**
 * Groq client — free alternative while the Anthropic account has no
 * funded credits. OpenAI-compatible API, plain fetch, no SDK. Same
 * contract as anthropicClient.js: prompt in, text out, throws on failure.
 * Free key: console.groq.com.
 */

const GROQ_MODEL = 'llama-3.3-70b-versatile'

async function callGroq(prompt) {
  if (!process.env.GROQ_API_KEY) {
    throw new Error(
      'GROQ_API_KEY is not set. Get a free key from console.groq.com and add it to your .env (locally) or Railway environment variables (deployed).'
    )
  }

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 4096,
      temperature: 0,
    }),
  })

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '')
    throw new Error(`Groq API error (HTTP ${response.status}): ${errorBody.slice(0, 300)}`)
  }

  const data = await response.json()
  const text = data.choices?.[0]?.message?.content
  if (!text) {
    throw new Error('Groq response contained no message content')
  }
  return text
}

module.exports = { callGroq, GROQ_MODEL }
