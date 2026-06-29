/**
 * Groq client — a free alternative to Anthropic while ANTHROPIC_API_KEY's
 * account has no funded credits. Groq's API is OpenAI-compatible, so this
 * is a plain fetch() call, no SDK needed.
 *
 * Matches the same contract as anthropicClient.js's callClaude(prompt):
 * takes a prompt string, returns the model's text response string, throws
 * on failure. This is what makes swapping providers a one-line env var
 * change instead of a rewrite — see aiProvider.js.
 *
 * Get a free key from console.groq.com (no card required for the free tier
 * at time of writing — check Groq's current docs/limits, since free-tier
 * terms can change).
 */

// Llama 3.3 70B — a strong general-purpose open-weight model, well suited
// to a structured classification task like this. If categorisation
// quality isn't good enough, this is the first thing to try changing.
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
      temperature: 0, // deterministic-leaning for a classification task, not creative writing
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
