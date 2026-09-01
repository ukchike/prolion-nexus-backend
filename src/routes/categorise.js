const express = require('express')
const { categoriseTransactions, MAX_TRANSACTIONS_PER_REQUEST } = require('../lib/categorisationEngine')
const { getProvider } = require('../lib/aiProvider')
const { requireAuth } = require('../middleware/requireAuth')
const { categoriseLimiter } = require('../middleware/rateLimiters')
const { assertCompanyMembership, consumeAiCredits, EntitlementError } = require('../lib/entitlementService')

const router = express.Router()

router.post('/categorise-transactions', requireAuth, categoriseLimiter, async (req, res) => {
  try {
    let provider
    try {
      provider = getProvider()
    } catch (err) {
      return res.status(500).json({ error: err.message })
    }

    if (!process.env[provider.requiredEnvVar]) {
      return res.status(500).json({
        error: `${provider.requiredEnvVar} is not configured on this server (AI_PROVIDER="${provider.name}"). Add it to the Render service’s environment variables (or .env locally) before using categorisation.`,
      })
    }

    const { transactions, bankName, extraRules, companyId } = req.body

    if (!Array.isArray(transactions) || transactions.length === 0) {
      return res.status(400).json({ error: 'Request body must include a non-empty "transactions" array.' })
    }

    if (transactions.length > MAX_TRANSACTIONS_PER_REQUEST) {
      return res.status(400).json({
        error: `Too many transactions in one request (${transactions.length}). Max is ${MAX_TRANSACTIONS_PER_REQUEST} per request — split into smaller batches.`,
      })
    }

    for (const t of transactions) {
      if (!t.id || !t.description) {
        return res.status(400).json({
          error: 'Every transaction must include at least "id" and "description".',
        })
      }
    }

    // Both optional — a caller with no Template Engine selection (or an
    // older frontend build) simply omits them, and the prompt is
    // byte-identical to before this was added. Bounded defensively since
    // this ultimately lands inside an LLM prompt: extraRules is caller-
    // supplied (from the business's own resolved template today, but the
    // server has no way to verify that), so a generous-but-finite cap
    // keeps one request from ballooning token usage or the batch count.
    if (bankName !== undefined && (typeof bankName !== 'string' || bankName.length > 100)) {
      return res.status(400).json({ error: '"bankName" must be a string of 100 characters or fewer.' })
    }
    if (extraRules !== undefined) {
      const isValid = Array.isArray(extraRules) && extraRules.length <= 100
        && extraRules.every((r) => typeof r === 'string' && r.length <= 500)
      if (!isValid) {
        return res.status(400).json({ error: '"extraRules" must be an array of at most 100 strings, each 500 characters or fewer.' })
      }
    }

    // Optional for the same backward-compatibility reason as statements.js
    // — but without it, this AI call runs uncounted against no company's
    // allowance, so a real client always sends it. Checked only after
    // every input-validation branch above, so a 400 never costs a credit.
    if (typeof companyId === 'string') {
      await assertCompanyMembership(req.user.id, companyId)
      await consumeAiCredits({ companyId, userId: req.user.id, feature: 'categorisation', amount: 1 })
    }

    const result = await categoriseTransactions(transactions, provider.call, { bankName, extraRules })
    return res.json({ ...result, provider: provider.name })
  } catch (err) {
    if (err instanceof EntitlementError) {
      return res.status(err.status).json({ error: err.message, upgradeMetric: err.upgradeMetric })
    }
    console.error('Categorisation error:', err)
    return res.status(500).json({ error: err.message || 'Failed to categorise transactions.' })
  }
})

module.exports = router
