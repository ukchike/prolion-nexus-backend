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

// Haiku, not Sonnet: categorisation is a high-volume, well-defined
// classification task — pick from a fixed list given a short
// description. That's well within a smaller model's capability, and at
// statement volumes (dozens to hundreds of transactions per upload),
// the cost and latency difference between Haiku and Sonnet adds up.
// If categorisation quality turns out to be unsatisfactory in practice,
// this is the first thing to try changing.
const MODEL = 'claude-haiku-4-5-20251001'

/**
 * Sends a prompt to Claude and returns the raw text response.
 * Kept as a thin, single-purpose function so categorisationEngine.js
 * can inject a fake version of this for testing without a real API key.
 */
async function callClaude(prompt) {
  const anthropic = getClient()
  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
  })

  const textBlock = message.content.find((block) => block.type === 'text')
  if (!textBlock) {
    throw new Error('Claude response contained no text block')
  }
  return textBlock.text
}

module.exports = { callClaude, MODEL }
