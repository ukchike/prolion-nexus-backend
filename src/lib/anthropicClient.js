const Anthropic = require('@anthropic-ai/sdk')

let client = null

function getClient() {
  if (!client) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error(
        'ANTHROPIC_API_KEY is not set. Get one from console.anthropic.com and add it to your .env (locally) or Railway environment variables (deployed).'
      )
    }
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  }
  return client
}

// Haiku: categorisation is a high-volume, well-defined classification
// task within a smaller model's capability. Switch to Sonnet if quality
// proves unsatisfactory on real data.
const MODEL = 'claude-haiku-4-5-20251001'

/**
 * `options.messages`/`options.system` support the multi-turn AI
 * Assistant (assistantEngine.js) alongside the categorisation engine's
 * plain single-string prompt — categorisation call sites are untouched
 * since `options` defaults to {} and falls back to wrapping `prompt` as
 * a single user turn.
 */
async function callClaude(prompt, options = {}) {
  const anthropic = getClient()
  const message = await anthropic.messages.create({
    model: MODEL,
    // Each result now carries a confidence score and a short reason
    // alongside the category, roughly doubling per-entry response size —
    // 4096 was already snug for a full batch before that addition.
    max_tokens: 6000,
    ...(options.system ? { system: options.system } : {}),
    messages: options.messages || [{ role: 'user', content: prompt }],
  })

  const textBlock = message.content.find((block) => block.type === 'text')
  if (!textBlock) {
    throw new Error('Claude response contained no text block')
  }
  return textBlock.text
}

module.exports = { callClaude, MODEL }
