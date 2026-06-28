const express = require('express')
const { categoriseTransactions, MAX_TRANSACTIONS_PER_REQUEST } = require('../lib/categorisationEngine')
const { callClaude } = require('../lib/anthropicClient')

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
 * Response: { results: [{id, category, category_group}], failedIds: [...],
 *             batchErrors: [...], totalProcessed, totalFailed }
 */
router.post('/categorise-transactions', async (req, res) => {
  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(500).json({
        error: 'ANTHROPIC_API_KEY is not configured on this server. Add it to Railway environment variables (or .env locally) before using categorisation.',
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

    const result = await categoriseTransactions(transactions, callClaude)
    return res.json(result)
  } catch (err) {
    console.error('Categorisation error:', err)
    return res.status(500).json({ error: err.message || 'Failed to categorise transactions.' })
  }
})

module.exports = router
