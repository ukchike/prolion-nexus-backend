/**
 * Groq client — free alternative while the Anthropic account has no
 * funded credits. OpenAI-compatible API, plain fetch, no SDK. Same
 * contract as anthropicClient.js: prompt in, text out, throws on failure.
 * Free key: console.groq.com.
 */

const GROQ_MODEL = 'llama-3.3-70b-versatile'
const MAX_RETRIES = 3

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Groq's 429 body names the exact wait ("Please try again in 5.46s") since
// the free on-demand tier's tokens-per-minute budget refills continuously
// rather than resetting on the clock minute — honor that instead of
// guessing a backoff, and pad it slightly since the quoted figure is a
// lower bound.
function parseRetryAfterMs(errorBody) {
  const match = errorBody.match(/try again in ([\d.]+)s/i)
  return match ? Math.ceil(parseFloat(match[1]) * 1000) + 500 : null
}

/**
 * Public entry point — `options.messages`/`options.system` support the
 * multi-turn AI Assistant (assistantEngine.js) alongside the
 * categorisation engine's plain single-string prompt. The retry
 * attempt counter stays internal (attemptGroq) so this signature
 * matches callClaude's (prompt, options), letting aiProvider.js's
 * generic `provider.call(prompt, options)` work for either provider.
 */
async function callGroq(prompt, options = {}) {
  return attemptGroq(prompt, options, 1)
}

async function attemptGroq(prompt, options, attempt) {
  if (!process.env.GROQ_API_KEY) {
    throw new Error(
      'GROQ_API_KEY is not set. Get a free key from console.groq.com and add it to your .env (locally) or Railway environment variables (deployed).'
    )
  }

  const messages = options.system
    ? [{ role: 'system', content: options.system }, ...(options.messages || [{ role: 'user', content: prompt }])]
    : options.messages || [{ role: 'user', content: prompt }]

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages,
      // Cap only, not a token reservation — actual usage against the free
      // tier's TPM budget still depends on what's actually generated.
      // Raised alongside anthropicClient.js since each result now carries
      // a confidence score and reason (see categorisationEngine.js).
      max_tokens: 6000,
      temperature: 0,
    }),
  })

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '')

    if (response.status === 429 && attempt <= MAX_RETRIES) {
      const retryAfterMs = parseRetryAfterMs(errorBody) ?? attempt * 2000
      await sleep(retryAfterMs)
      return attemptGroq(prompt, options, attempt + 1)
    }

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
