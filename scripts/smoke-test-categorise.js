/**
 * Run this AFTER adding a real ANTHROPIC_API_KEY to your .env, to do one
 * real end-to-end check that the categorisation engine works against the
 * live Claude API — not a mocked response like test/categorise.test.js.
 *
 * Usage:
 *   cd nexus-backend
 *   node scripts/smoke-test-categorise.js
 *
 * This makes ONE real API call (a few cents at most) and prints what
 * Claude actually returned for 5 sample transactions, so you can eyeball
 * whether the categories look sensible before trusting this on a real
 * client statement with hundreds of transactions.
 */

/**
 * Run this AFTER adding a real API key to your .env, to do one real
 * end-to-end check that the categorisation engine works against a live
 * AI provider — not a mocked response like test/categorise.test.js.
 *
 * Tests whichever provider AI_PROVIDER selects (defaults to 'anthropic';
 * set AI_PROVIDER=groq in .env to test the free Groq alternative instead)
 * — same provider-selection logic the real route uses, so this is a
 * faithful test of what production will actually do.
 *
 * Usage:
 *   cd nexus-backend
 *   node scripts/smoke-test-categorise.js
 *
 * This makes ONE real API call and prints what the model actually
 * returned for 9 sample transactions, so you can eyeball whether the
 * categories look sensible before trusting this on a real client
 * statement with hundreds of transactions.
 */

require('dotenv').config()
const { categoriseTransactions } = require('../src/lib/categorisationEngine')
const { getProvider } = require('../src/lib/aiProvider')

const SAMPLE_TRANSACTIONS = [
  { id: '1', description: 'TRANSFER FROM DANGOTE AGRO LTD', debit: null, credit: 500000 },
  { id: '2', description: 'POS PURCHASE SHOPRITE IKEJA', debit: 15000, credit: null },
  { id: '3', description: 'PAYMENT TO STAFF SALARY JAN', debit: 120000, credit: null },
  { id: '4', description: 'SMS ALERT CHARGE', debit: 4, credit: null },
  { id: '5', description: 'VAT PAYMENT FIRS', debit: 8500, credit: null },
  { id: '6', description: 'PP_RALPAINTS/Others/ACB /YAHAYA TAIGA HARUNA', debit: 4164000, credit: null },
  // These three specifically test the Sprint 2 reclassification — if
  // the prompt guidance isn't working, these will come back as Income/
  // Expense instead of Balance Sheet, which is the exact bug being
  // checked for here.
  { id: '7', description: 'LOAN DISBURSEMENT FROM ACCESS BANK', debit: null, credit: 2000000 },
  { id: '8', description: 'LOAN REPAYMENT - PRINCIPAL AND INTEREST', debit: 250000, credit: null },
  { id: '9', description: 'WITHDRAWAL BY DIRECTOR - PERSONAL USE', debit: 100000, credit: null },
]

async function main() {
  const provider = getProvider()

  if (!process.env[provider.requiredEnvVar]) {
    console.error(
      `${provider.requiredEnvVar} is not set in your .env (AI_PROVIDER="${provider.name}"). ` +
      (provider.name === 'groq'
        ? 'Get a free key from console.groq.com first.'
        : 'Get one from console.anthropic.com first.')
    )
    process.exit(1)
  }

  console.log(`Provider: ${provider.name}`)
  console.log(`Sending ${SAMPLE_TRANSACTIONS.length} sample transactions...`)
  console.log('(This makes one real API call.)\n')

  const result = await categoriseTransactions(SAMPLE_TRANSACTIONS, provider.call)

  console.log('=== RESULTS ===')
  for (const r of result.results) {
    const txn = SAMPLE_TRANSACTIONS.find((t) => t.id === r.id)
    console.log(`"${txn.description}"\n  -> ${r.category} (${r.category_group})\n`)
  }

  if (result.failedIds.length > 0) {
    console.log('=== FAILED ===')
    console.log(result.failedIds)
  }

  console.log(`\nProcessed: ${result.totalProcessed} | Failed: ${result.totalFailed}`)

  if (result.batchErrors.length > 0) {
    console.log('\n=== BATCH ERRORS ===')
    console.log(JSON.stringify(result.batchErrors, null, 2))
  }

  console.log('\nEyeball check: do these categories look right for each description above?')
  console.log('Especially check #7, #8, #9 — these should land in Balance Sheet:')
  console.log('  #7 -> "Loan Received - Current" (no term stated, so Current is the right default)')
  console.log('  #8 -> "Loan Repayment - Principal (Current)" (the combined principal+interest')
  console.log('        description is genuinely ambiguous on splitting interest out — check')
  console.log('        whether this needs a manual correction in the Review screen)')
  console.log('  #9 -> "Owner/Director Withdrawal"')
  console.log('None of these three should be Income or Expense. That reclassification is the')
  console.log('main thing this smoke test exists to verify.')
  console.log('If something looks consistently wrong, the prompt in')
  console.log('src/lib/categorisationEngine.js (buildPrompt) is the place to adjust.')
}

main().catch((err) => {
  console.error('Smoke test failed:', err.message)
  process.exit(1)
})
