const express = require('express')
const { getProvider } = require('../lib/aiProvider')
const { validateAssistantRequest, askAssistant } = require('../lib/assistantEngine')
const { requireAuth } = require('../middleware/requireAuth')
const { assistantLimiter } = require('../middleware/rateLimiters')
const { assertCompanyMembership, consumeAiCredits, EntitlementError } = require('../lib/entitlementService')

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
        error: `${provider.requiredEnvVar} is not configured on this server (AI_PROVIDER="${provider.name}"). Add it to the Render service’s environment variables (or .env locally) before using the assistant.`,
      })
    }

    const validation = validateAssistantRequest(req.body)
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error })
    }

    // Optional for backward compatibility — see the same note in
    // categorise.js. Checked after validation so a malformed question
    // never costs a credit.
    const companyId = typeof req.body.companyId === 'string' ? req.body.companyId : null
    if (companyId) {
      await assertCompanyMembership(req.user.id, companyId)
      await consumeAiCredits({ companyId, userId: req.user.id, feature: 'assistant', amount: 1 })
    }

    const answer = await askAssistant(validation.data, provider.call)
    return res.json({ answer, provider: provider.name })
  } catch (err) {
    if (err instanceof EntitlementError) {
      return res.status(err.status).json({ error: err.message, upgradeMetric: err.upgradeMetric })
    }
    console.error('Assistant error:', err)
    return res.status(500).json({ error: err.message || 'Failed to get an answer from the assistant.' })
  }
})

module.exports = router
