/**
 * Core AI categorisation logic. Separated from the Express route so the
 * prompt-building and response-parsing logic can be unit-tested with a
 * mocked AI response, without a real API key or network call.
 */

const { ALL_CATEGORIES, CATEGORY_TO_GROUP, CATEGORY_GROUPS, UNCLASSIFIED_CATEGORIES, metadataForCategory } = require('./categoryTaxonomy')
const { cleanNarration, extractMerchantName } = require('./narrationCleaner')

const FALLBACK_CATEGORY = UNCLASSIFIED_CATEGORIES[0]
// Smaller than before (was 40) — confidence + reason roughly double each
// result's size, and this keeps a batch's JSON response comfortably
// inside max_tokens on both providers rather than risking truncation.
const BATCH_SIZE = 25
const MAX_TRANSACTIONS_PER_REQUEST = 1000
// Applied when the model omits/mangles confidence — moderate rather than
// high, since a missing confidence is itself a signal the response was
// malformed and shouldn't be silently presented as trustworthy.
const DEFAULT_CONFIDENCE = 60
const DEFAULT_REASON = 'Classified by AI from the transaction description; no specific reason was returned.'

/**
 * @param {object[]} transactions
 * @param {object} [options]
 * @param {string} [options.bankName] - shown as context; some narration
 *   conventions (routing-code formats, settlement-batch phrasing) are
 *   bank-specific, so naming the bank helps the model calibrate.
 * @param {string[]} [options.extraRules] - additional classification
 *   rules from the business's resolved Template Engine selection
 *   (Business Activities + Operational Modules + Country pack —
 *   nexus-app's src/templates/resolver.js's `aiRules`), appended after
 *   the built-in guidance rather than replacing it, so a business with
 *   no activities/modules selected gets exactly today's prompt.
 */
function buildPrompt(transactions, options = {}) {
  const { bankName, extraRules = [] } = options
  const categoryList = ALL_CATEGORIES.map((c) => `- ${c}`).join('\n')

  const transactionLines = transactions
    .map((t) => {
      const movement = t.debit ? `debit ${t.debit}` : t.credit ? `credit ${t.credit}` : 'no amount'
      const description = (t.description || '').slice(0, 200)
      const merchant = extractMerchantName(cleanNarration(description))
      const merchantPart = merchant ? ` | probable merchant: ${merchant}` : ''
      return `${t.id} | ${description}${merchantPart} | ${movement}`
    })
    .join('\n')

  const extraRulesBlock = extraRules.length > 0
    ? `\nAdditional rules for this business (from its selected activities, features, and country):\n${extraRules.map((r) => `- ${r}`).join('\n')}\n`
    : ''

  return `You are categorising transactions from a Nigerian small business bank statement for tax and bookkeeping purposes.${bankName ? ` The statement is from ${bankName}.` : ''}
${extraRulesBlock}

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
  - Money coming in described as a loan, facility drawdown, or overdraft drawdown is "Loan Received - Current" or "Loan Received - Non-current" (Balance Sheet), never "Sales Revenue" or "Other Income"
  - Money going out to repay a loan's principal is "Loan Repayment - Principal (Current)" or "Loan Repayment - Principal (Non-current)" (Balance Sheet); only an explicitly-labelled interest portion is "Interest Expense" (P&L)
  - For the Current vs Non-current choice on loans: if the description mentions "overdraft", "short-term", or gives no term information at all, default to Current — that's the more common case for informal SME lending. Only use Non-current if the description clearly indicates a multi-year term (e.g. "term loan", "asset finance", "mortgage")
  - Money withdrawn by an owner/director for personal use (not a business expense, not payroll) is "Owner/Director Withdrawal" (Balance Sheet), never an expense category
  - Capital injected by an owner/shareholder is "Capital Introduced" (Balance Sheet), never income
  - A dividend payment to shareholders is "Dividend Paid" (Balance Sheet), never an expense
- Director/shareholder current accounts — the DIRECTION determines the classification, not the account name:
  - Money paid OUT to a director as a loan or advance the company expects back (description suggests loan/advance/IOU, not drawings and not salary) is "Staff & Director Loans (Advanced/Repaid)" (Balance Sheet, a receivable) — a director owing the company is an asset, never a negative liability
  - Money received back from a director repaying such an advance is also "Staff & Director Loans (Advanced/Repaid)"
  - Money coming IN from a director as a loan TO the company is "Loan Received - Current" (a related-party liability), unless clearly a capital injection ("Capital Introduced")
- Foreign exchange differences are split by direction and are never ordinary operating items:
  - A realised exchange GAIN (description mentions FX gain, exchange difference in the business's favour, revaluation credit) is "Foreign Exchange Gain" (Income)
  - A realised exchange LOSS is "Foreign Exchange Loss" — this is a non-operating expense, kept out of ordinary operating costs so it does not distort Operating Profit
- Cost of Sales vs Operating Expenses (both are Expense category_group, but distinct for Gross Profit purposes):
  - Payments for raw materials, stock, or goods purchased for resale are "Cost of Goods Sold (Purchases)"
  - Wages paid specifically to staff directly involved in production/making the goods sold (not general admin/office staff) are "Direct Wages"
  - Costs directly tied to acquiring or producing the goods sold (e.g. carriage inwards, import clearing on stock) are "Direct Expenses (incl. Carriage Inwards)"
  - When in doubt whether a cost is Cost of Sales or a general Operating Expense, prefer the Operating Expense category — Cost of Sales should only be used when the description clearly ties the cost to producing/acquiring goods for resale
- A payment received that's clearly settlement of an old invoice (not a new sale) is "Trade Receivables Collected"; a payment made that's clearly settling an old supplier bill (not a new purchase) is "Trade Payables Settled" — both Balance Sheet, not Income/Expense
- An upfront payment for a future period (e.g. a year's rent or insurance paid in advance) is "Prepaid Expenses" (Balance Sheet), not an immediate expense

Transactions (format: id | description | amount):
${transactionLines}

For each transaction also provide:
- confidence: an integer 0-100 for how certain you are, given ONLY the narration and amount (no external knowledge of this specific business). Reserve 90+ for narrations that are unambiguous (e.g. explicit "SALARY", "VAT", a named known category keyword); use 50-70 when the narration gives a weak or generic signal; use below 50 when you are essentially guessing.
- reason: ONE short sentence (under 15 words) grounded in what's actually in the narration — e.g. "Narration contains 'SALARY' and matches payroll wording", not a generic restatement of the category name.

Respond with ONLY a JSON array, no markdown code fences, no explanation, no preamble. Each element must be exactly:
{"id": "<the id from the input>", "category": "<exact category name from the list above>", "confidence": <integer 0-100>, "reason": "<short reason>"}`
}

/**
 * Strips markdown code fences, then parses the JSON. Falls back to
 * extracting the first [...] block from anywhere in the text — smaller/
 * open-weight models (e.g. via Groq) are chattier about wrapping JSON in
 * explanatory text than Claude, even when told not to.
 */
function parseAIResponse(responseText) {
  const cleaned = responseText
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()

  try {
    const parsed = JSON.parse(cleaned)
    if (!Array.isArray(parsed)) {
      throw new Error('Expected a JSON array, got something else')
    }
    return parsed
  } catch (firstAttemptError) {
    const arrayMatch = cleaned.match(/\[[\s\S]*\]/)
    if (!arrayMatch) {
      throw firstAttemptError
    }
    const parsed = JSON.parse(arrayMatch[0])
    if (!Array.isArray(parsed)) {
      throw new Error('Expected a JSON array, got something else')
    }
    return parsed
  }
}

function validateEntry(entry) {
  if (!entry || (typeof entry.id !== 'string' && typeof entry.id !== 'number')) return null
  const category = ALL_CATEGORIES.includes(entry.category) ? entry.category : FALLBACK_CATEGORY
  const category_group = CATEGORY_TO_GROUP[category] || CATEGORY_GROUPS.UNCLASSIFIED

  // A hallucinated category is exactly the case where the model's own
  // confidence claim can't be trusted either — override it rather than
  // let a fabricated "95% confident" reach the user for a category we
  // just silently swapped out for Uncategorised.
  const isFallback = category !== entry.category
  const rawConfidence = Number(entry.confidence)
  const confidence = isFallback
    ? 0
    : Number.isFinite(rawConfidence) ? Math.max(0, Math.min(100, Math.round(rawConfidence))) : DEFAULT_CONFIDENCE
  const reason = isFallback
    ? `"${entry.category}" isn't a recognised category — defaulted to Uncategorised for review.`
    : (typeof entry.reason === 'string' && entry.reason.trim()) ? entry.reason.trim().slice(0, 200) : DEFAULT_REASON

  const { deductible, vatTreatment } = metadataForCategory(category)

  return { id: String(entry.id), category, category_group, confidence, reason, deductible, vatTreatment, source: 'ai' }
}

function chunk(array, size) {
  const chunks = []
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size))
  }
  return chunks
}

async function categoriseBatch(transactions, callAI, options = {}) {
  const prompt = buildPrompt(transactions, options)
  const responseText = await callAI(prompt)
  const parsed = parseAIResponse(responseText)

  const requestedIds = new Set(transactions.map((t) => String(t.id)))
  const results = []
  const seenIds = new Set()

  for (const entry of parsed) {
    const validated = validateEntry(entry)
    // Keep only the first entry per id — an LLM response that repeats a
    // transaction id (hallucination/repetition) would otherwise produce
    // two categorisation results for one transaction.
    if (validated && requestedIds.has(validated.id) && !seenIds.has(validated.id)) {
      seenIds.add(validated.id)
      results.push(validated)
    }
  }

  const returnedIds = new Set(results.map((r) => r.id))
  const failedIds = transactions.map((t) => String(t.id)).filter((id) => !returnedIds.has(id))

  return { results, failedIds }
}

async function categoriseTransactions(transactions, callAI, options = {}) {
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
      const { results, failedIds } = await categoriseBatch(batches[i], callAI, options)
      allResults.push(...results)
      allFailedIds.push(...failedIds)
    } catch (err) {
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
  parseAIResponse,
  validateEntry,
  categoriseBatch,
  categoriseTransactions,
  BATCH_SIZE,
  MAX_TRANSACTIONS_PER_REQUEST,
  FALLBACK_CATEGORY,
}
