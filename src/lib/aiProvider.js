/**
 * Picks which AI provider to use, based on the AI_PROVIDER env var.
 * Defaults to 'anthropic'. Set AI_PROVIDER=groq to use the free Groq
 * option. Switching is an env var change, not a code change.
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
