/**
 * One real end-to-end check against the live AI provider configured by
 * AI_PROVIDER. Run after adding a real key: node scripts/smoke-test-categorise.js
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
  { id: '7', description: 'LOAN DISBURSEMENT FROM ACCESS BANK', debit: null, credit: 2000000 },
  { id: '8', description: 'LOAN REPAYMENT - PRINCIPAL AND INTEREST', debit: 250000, credit: null },
  { id: '9', description: 'WITHDRAWAL BY DIRECTOR - PERSONAL USE', debit: 100000, credit: null },
  { id: '10', description: 'PAYMENT TO SUPPLIER FOR RAW MATERIALS - PAINT PIGMENTS', debit: 850000, credit: null },
  // FX split + director-account direction tests (July 2026 taxonomy revision)
  { id: '11', description: 'REVALUATION GAIN ON DOMICILIARY ACCOUNT - EXCHANGE DIFFERENCE', debit: null, credit: 320000 },
  { id: '12', description: 'REALISED EXCHANGE LOSS ON USD SUPPLIER PAYMENT', debit: 450000, credit: null },
  { id: '13', description: 'LOAN ADVANCE TO DIRECTOR - MR ADEBAYO - TO BE REPAID Q4', debit: 1500000, credit: null },
]

async function main() {
  const provider = getProvider()

  if (!process.env[provider.requiredEnvVar]) {
    console.error(`${provider.requiredEnvVar} is not set (AI_PROVIDER="${provider.name}").`)
    process.exit(1)
  }

  console.log(`Provider: ${provider.name}`)
  console.log(`Sending ${SAMPLE_TRANSACTIONS.length} sample transactions...\n`)

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

  console.log('\nEyeball check — #7-#9 should be Balance Sheet (Loan Received - Current,')
  console.log('Loan Repayment - Principal (Current), Owner/Director Withdrawal);')
  console.log('#10 should be Cost of Goods Sold (Purchases);')
  console.log('#11 -> "Foreign Exchange Gain" (INCOME); #12 -> "Foreign Exchange Loss"')
  console.log('(EXPENSE, non-operating); #13 -> "Staff & Director Loans (Advanced/Repaid)"')
  console.log('(BALANCE_SHEET — a director owing the company is a receivable, never')
  console.log('an expense and never a negative liability).')
}

main().catch((err) => {
  console.error('Smoke test failed:', err.message)
  process.exit(1)
})
