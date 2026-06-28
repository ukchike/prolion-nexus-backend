/**
 * Core AI categorisation logic.
 *
 * Deliberately separated from the Express route (categorise.js) so the
 * prompt-building and response-parsing logic can be unit-tested with a
 * mocked Claude response, without needing a real API key or network call.
 * The actual live API call (callClaudeForBatch) is the only part that
 * can't be exercised without a real ANTHROPIC_API_KEY — see
 * test/categorise.test.js for what IS covered.
 */

const { ALL_CATEGORIES, CATEGORY_TO_GROUP, CATEGORY_GROUPS, UNCLASSIFIED_CATEGORIES } = require('./categoryTaxonomy')

const FALLBACK_CATEGORY = UNCLASSIFIED_CATEGORIES[0] // 'Uncategorised'

// How many transactions go into a single Claude API call. Keeps prompt
// size and output size predictable, and means a failure only affects
// one chunk's worth of transactions rather than the whole statement.
const BATCH_SIZE = 40

// Hard ceiling on a single request to this endpoint — a safety guard
// against an accidental request for an unreasonable number of
// transactions running up API costs unexpectedly.
const MAX_TRANSACTIONS_PER_REQUEST = 1000

function buildPrompt(transactions) {
  const categoryList = ALL_CATEGORIES.map((c) => `- ${c}`).join('\n')

  const transactionLines = transactions
    .map((t) => {
      const movement = t.debit ? `debit ${t.debit}` : t.credit ? `credit ${t.credit}` : 'no amount'
      // Truncate very long descriptions so one noisy transaction doesn't
      // blow out the prompt size disproportionately.
      const description = (t.description || '').slice(0, 200)
      return `${t.id} | ${description} | ${movement}`
    })
    .join('\n')

  return `You are categorising transactions from a Nigerian small business bank statement for tax and bookkeeping purposes.

Assign EXACTLY ONE category to each transaction from this list (use the exact spelling shown):
${categoryList}

Guidance:
- "debit" means money left the account (an expense, a withdrawal, a transfer out)
- "credit" means money came into the account (income, a refund, a transfer in)
- Use "Uncategorised" only when genuinely ambiguous — prefer a real category whenever the description gives any usable signal
- Bank-related fees (SMS alerts, account maintenance, COT) are "Bank Charges", not generic expenses
- Recognisable salary/payroll language is "Staff Salaries & Wages"
- Recognisable tax authority references (FIRS, NRS, VAT, WHT, PAYE remittance) are "Tax Payments"
- IMPORTANT accounting distinction — do not treat loan or drawing movements as income/expense:
  - Money coming in described as a loan, facility drawdown, or overdraft drawdown is "Loan Received" (Balance Sheet), never "Sales Revenue" or "Other Income"
  - Money going out to repay a loan's principal is "Loan Repayment - Principal" (Balance Sheet); only an explicitly-labelled interest portion is "Interest Expense" (P&L)
  - Money withdrawn by an owner/director for personal use (not a business expense, not payroll) is "Owner/Director Withdrawal" (Balance Sheet), never an expense category
  - Capital injected by an owner/shareholder is "Capital Introduced" (Balance Sheet), never income

Transactions (format: id | description | amount):
${transactionLines}

Respond with ONLY a JSON array, no markdown code fences, no explanation, no preamble. Each element must be exactly:
{"id": "<the id from the input>", "category": "<exact category name from the list above>"}`
}

/**
 * Strips markdown code fences if the model added them despite being
 * asked not to (this happens often enough in practice to guard against),
 * then parses the JSON. Throws if the result isn't valid JSON.
 */
function parseClaudeResponse(responseText) {
  const cleaned = responseText
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()

  const parsed = JSON.parse(cleaned)
  if (!Array.isArray(parsed)) {
    throw new Error('Expected a JSON array, got something else')
  }
  return parsed
}

/**
 * Validates and normalises one parsed entry from Claude's response.
 * If the category isn't one we recognise (hallucinated or misspelled),
 * falls back to "Uncategorised" rather than saving a category_group
 * that doesn't actually exist in the schema's CHECK constraint — an
 * invalid category_group would make the database insert/update fail
 * outright, which is worse than a slightly-wrong-but-valid fallback.
 */
function validateEntry(entry) {
  if (!entry || typeof entry.id !== 'string' && typeof entry.id !== 'number') return null

  const category = ALL_CATEGORIES.includes(entry.category) ? entry.category : FALLBACK_CATEGORY
  const category_group = CATEGORY_TO_GROUP[category] || CATEGORY_GROUPS.UNCLASSIFIED

  return { id: String(entry.id), category, category_group }
}

function chunk(array, size) {
  const chunks = []
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size))
  }
  return chunks
}

/**
 * Categorises one batch (already chunked to BATCH_SIZE or smaller) by
 * calling the provided `callClaude` function and validating the result.
 * `callClaude` is injected so this function can be unit-tested with a
 * fake implementation instead of a real API call.
 */
async function categoriseBatch(transactions, callClaude) {
  const prompt = buildPrompt(transactions)
  const responseText = await callClaude(prompt)
  const parsed = parseClaudeResponse(responseText)

  const requestedIds = new Set(transactions.map((t) => String(t.id)))
  const results = []

  for (const entry of parsed) {
    const validated = validateEntry(entry)
    if (validated && requestedIds.has(validated.id)) {
      results.push(validated)
    }
  }

  // Any transaction Claude didn't return a result for (response was
  // short, malformed for that entry, etc.) is reported as failed rather
  // than silently dropped — the caller decides what to do (retry, leave
  // UNCLASSIFIED, surface to the user).
  const returnedIds = new Set(results.map((r) => r.id))
  const failedIds = transactions.map((t) => String(t.id)).filter((id) => !returnedIds.has(id))

  return { results, failedIds }
}

/**
 * Main entry point: categorises an arbitrary-length list of transactions
 * by splitting into BATCH_SIZE chunks and processing them in sequence.
 * Sequential (not parallel) deliberately — keeps Claude API rate limits
 * predictable; can be revisited for parallel chunks once volume justifies it.
 */
async function categoriseTransactions(transactions, callClaude) {
  if (transactions.length > MAX_TRANSACTIONS_PER_REQUEST) {
    throw new Error(
      `Too many transactions in one request (${transactions.length}). Max is ${MAX_TRANSACTIONS_PER_REQUEST} — split into smaller requests.`
    )
  }

  const batches = chunk(transactions, BATCH_SIZE)
  const allResults = []
  const allFailedIds = []
  const batchErrors = []

  for (let i = 0; i < batches.length; i++) {
    try {
      const { results, failedIds } = await categoriseBatch(batches[i], callClaude)
      allResults.push(...results)
      allFailedIds.push(...failedIds)
    } catch (err) {
      // One bad batch (network error, completely malformed response)
      // doesn't take down the whole request — those transactions are
      // reported as failed, everything else still gets processed.
      const idsInBatch = batches[i].map((t) => String(t.id))
      allFailedIds.push(...idsInBatch)
      batchErrors.push({ batchIndex: i, error: err.message })
    }
  }

  return {
    results: allResults,
    failedIds: allFailedIds,
    batchErrors,
    totalProcessed: allResults.length,
    totalFailed: allFailedIds.length,
  }
}

module.exports = {
  buildPrompt,
  parseClaudeResponse,
  validateEntry,
  categoriseBatch,
  categoriseTransactions,
  BATCH_SIZE,
  MAX_TRANSACTIONS_PER_REQUEST,
  FALLBACK_CATEGORY,
}
