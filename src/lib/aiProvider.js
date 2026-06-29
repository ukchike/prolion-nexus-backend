/**
 * Picks which AI provider to use for categorisation, based on the
 * AI_PROVIDER environment variable. Defaults to 'anthropic' for
 * backward compatibility — set AI_PROVIDER=groq in .env / Railway to
 * use the free Groq option instead while ANTHROPIC_API_KEY's account
 * has no funded credits. Switching back later is a one-line env var
 * change, not a code change.
 */

const { callClaude } = require('./anthropicClient')
const { callGroq } = require('./groqClient')

const PROVIDERS = {
  anthropic: { call: callClaude, requiredEnvVar: 'ANTHROPIC_API_KEY' },
  groq: { call: callGroq, requiredEnvVar: 'GROQ_API_KEY' },
}

function getProviderName() {
  return (process.env.AI_PROVIDER || 'anthropic').toLowerCase()
}

function getProvider() {
  const name = getProviderName()
  const provider = PROVIDERS[name]
  if (!provider) {
    throw new Error(`Unknown AI_PROVIDER "${name}". Valid options: ${Object.keys(PROVIDERS).join(', ')}`)
  }
  return { name, ...provider }
}

module.exports = { getProvider, getProviderName, PROVIDERS }
