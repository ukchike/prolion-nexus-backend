const express = require('express')
const { getProvider } = require('../lib/aiProvider')
const { validateAssistantRequest, askAssistant } = require('../lib/assistantEngine')
const { requireAuth } = require('../middleware/requireAuth')
const { assistantLimiter } = require('../middleware/rateLimiters')

const router = express.Router()

router.post('/assistant/query', requireAuth, assistantLimiter, async (req, res) => {
  try {
    let provider
    try {
      provider = getProvider()
    } catch (err) {
      return res.status(500).json({ error: err.message })
    }

    if (!process.env[provider.requiredEnvVar]) {
      return res.status(500).json({
        error: `${provider.requiredEnvVar} is not configured on this server (AI_PROVIDER="${provider.name}"). Add it to Railway environment variables (or .env locally) before using the assistant.`,
      })
    }

    const validation = validateAssistantRequest(req.body)
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error })
    }

    const answer = await askAssistant(validation.data, provider.call)
    return res.json({ answer, provider: provider.name })
  } catch (err) {
    console.error('Assistant error:', err)
    return res.status(500).json({ error: err.message || 'Failed to get an answer from the assistant.' })
  }
})

module.exports = router
