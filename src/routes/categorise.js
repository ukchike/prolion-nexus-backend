const express = require('express')
const { categoriseTransactions, MAX_TRANSACTIONS_PER_REQUEST } = require('../lib/categorisationEngine')
const { getProvider } = require('../lib/aiProvider')

const router = express.Router()

/**
 * POST /api/categorise-transactions
 * Body: { transactions: [{ id, description, debit, credit }, ...] }
 *
 * This route does NOT touch Supabase — same stateless pattern as
 * /api/parse-statement. The frontend is responsible for fetching the
 * transactions to send here, and for writing ai_category/category_group
 * back to the database once it gets a response.
 *
 * Which AI provider actually gets called is controlled by the
 * AI_PROVIDER env var (see aiProvider.js) — 'anthropic' (default) or
 * 'groq'. The response shape is identical either way.
 *
 * Response: { results: [{id, category, category_group}], failedIds: [...],
 *             batchErrors: [...], totalProcessed, totalFailed, provider }
 */
router.post('/categorise-transactions', async (req, res) => {
  try {
    let provider
    try {
      provider = getProvider()
    } catch (err) {
      return res.status(500).json({ error: err.message })
    }

    if (!process.env[provider.requiredEnvVar]) {
      return res.status(500).json({
        error: `${provider.requiredEnvVar} is not configured on this server (AI_PROVIDER="${provider.name}"). Add it to Railway environment variables (or .env locally) before using categorisation.`,
      })
    }

    const { transactions } = req.body

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

    const result = await categoriseTransactions(transactions, provider.call)
    return res.json({ ...result, provider: provider.name })
  } catch (err) {
    console.error('Categorisation error:', err)
    return res.status(500).json({ error: err.message || 'Failed to categorise transactions.' })
  }
})

module.exports = router
