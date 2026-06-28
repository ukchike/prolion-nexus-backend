const {
  buildPrompt,
  parseClaudeResponse,
  validateEntry,
  categoriseTransactions,
  BATCH_SIZE,
} = require('../src/lib/categorisationEngine')
const { ALL_CATEGORIES } = require('../src/lib/categoryTaxonomy')

let failures = 0

function check(label, condition) {
  if (condition) {
    console.log(`  PASS - ${label}`)
  } else {
    console.log(`  FAIL - ${label}`)
    failures++
  }
}

const SAMPLE_TRANSACTIONS = [
  { id: 'txn-1', description: 'TRANSFER FROM DANGOTE AGRO LTD', debit: null, credit: 500000 },
  { id: 'txn-2', description: 'POS PURCHASE SHOPRITE IKEJA', debit: 15000, credit: null },
  { id: 'txn-3', description: 'PAYMENT TO STAFF SALARY JAN', debit: 120000, credit: null },
  { id: 'txn-4', description: 'SMS ALERT CHARGE', debit: 4, credit: null },
  { id: 'txn-5', description: 'VAT PAYMENT FIRS', debit: 8500, credit: null },
]

function testPromptBuilding() {
  console.log('\n--- Testing prompt construction ---')
  const prompt = buildPrompt(SAMPLE_TRANSACTIONS)

  check('prompt includes every transaction id', SAMPLE_TRANSACTIONS.every((t) => prompt.includes(t.id)))
  check('prompt includes every category from the taxonomy', ALL_CATEGORIES.every((c) => prompt.includes(c)))
  check('prompt labels credits correctly', prompt.includes('credit 500000'))
  check('prompt labels debits correctly', prompt.includes('debit 15000'))
  check('prompt instructs JSON-only response', prompt.toLowerCase().includes('json array'))
}

function testResponseParsing() {
  console.log('\n--- Testing response parsing (defensive against markdown fences) ---')

  const cleanJson = '[{"id": "txn-1", "category": "Sales Revenue"}]'
  const withFences = '```json\n[{"id": "txn-1", "category": "Sales Revenue"}]\n```'
  const withFencesNoLang = '```\n[{"id": "txn-1", "category": "Sales Revenue"}]\n```'

  check('parses clean JSON', parseClaudeResponse(cleanJson)[0].id === 'txn-1')
  check('strips ```json fences', parseClaudeResponse(withFences)[0].id === 'txn-1')
  check('strips ``` fences without language tag', parseClaudeResponse(withFencesNoLang)[0].id === 'txn-1')

  let threwOnInvalid = false
  try {
    parseClaudeResponse('not valid json at all')
  } catch {
    threwOnInvalid = true
  }
  check('throws on genuinely invalid JSON (caller can catch and report)', threwOnInvalid)

  let threwOnNonArray = false
  try {
    parseClaudeResponse('{"id": "txn-1"}')
  } catch {
    threwOnNonArray = true
  }
  check('throws when response is valid JSON but not an array', threwOnNonArray)
}

function testCategoryValidation() {
  console.log('\n--- Testing category validation and fallback ---')

  const validEntry = validateEntry({ id: 'txn-1', category: 'Sales Revenue' })
  check('valid category passes through unchanged', validEntry.category === 'Sales Revenue')
  check('category_group correctly derived from category', validEntry.category_group === 'INCOME')

  const hallucinatedEntry = validateEntry({ id: 'txn-2', category: 'Totally Made Up Category' })
  check('hallucinated/unrecognised category falls back to Uncategorised', hallucinatedEntry.category === 'Uncategorised')
  check('fallback category_group is UNCLASSIFIED', hallucinatedEntry.category_group === 'UNCLASSIFIED')

  const missingId = validateEntry({ category: 'Sales Revenue' })
  check('entry with no id is rejected (returns null)', missingId === null)

  const expenseEntry = validateEntry({ id: 'txn-3', category: 'Bank Charges' })
  check('expense category correctly maps to EXPENSE group', expenseEntry.category_group === 'EXPENSE')
}

async function testFullCategorisationFlow() {
  console.log('\n--- Testing full categorisation flow with a mocked Claude response ---')

  // Simulates a well-behaved Claude response: correct categories for
  // every transaction, matching what a real call would plausibly return
  // for this exact sample data.
  const mockCallClaude = async (prompt) => {
    const ids = SAMPLE_TRANSACTIONS.map((t) => t.id)
    const categories = ['Sales Revenue', 'Cost of Goods Sold', 'Staff Salaries & Wages', 'Bank Charges', 'Tax Payments']
    const response = ids.map((id, i) => ({ id, category: categories[i] }))
    return JSON.stringify(response)
  }

  const result = await categoriseTransactions(SAMPLE_TRANSACTIONS, mockCallClaude)

  check('all 5 transactions categorised', result.totalProcessed === 5)
  check('zero failures with a well-behaved response', result.totalFailed === 0)
  check('credit transaction correctly categorised as income', result.results.find((r) => r.id === 'txn-1').category_group === 'INCOME')
  check('SMS charge correctly categorised as Bank Charges', result.results.find((r) => r.id === 'txn-4').category === 'Bank Charges')
}

async function testPartialFailureHandling() {
  console.log('\n--- Testing partial failure handling (Claude omits some transactions) ---')

  // Simulates Claude only returning results for 3 of 5 transactions —
  // should report the other 2 as failed, not crash or silently lose them.
  const mockIncompleteResponse = async () => {
    return JSON.stringify([
      { id: 'txn-1', category: 'Sales Revenue' },
      { id: 'txn-2', category: 'Cost of Goods Sold' },
      { id: 'txn-3', category: 'Staff Salaries & Wages' },
    ])
  }

  const result = await categoriseTransactions(SAMPLE_TRANSACTIONS, mockIncompleteResponse)

  check('3 transactions successfully categorised', result.totalProcessed === 3)
  check('2 transactions correctly reported as failed, not silently dropped', result.totalFailed === 2)
  check('failedIds contains the right ids', result.failedIds.includes('txn-4') && result.failedIds.includes('txn-5'))
}

async function testBatchFailureIsolation() {
  console.log('\n--- Testing that one bad batch doesn\'t take down the whole request ---')

  // Build enough transactions to force 2 batches, and make the API call
  // throw for every call — every transaction across both batches should
  // be reported as failed, with no unhandled exception escaping.
  const manyTransactions = Array.from({ length: BATCH_SIZE + 5 }, (_, i) => ({
    id: `txn-${i}`,
    description: `Test transaction ${i}`,
    debit: 100,
    credit: null,
  }))

  const mockAlwaysFails = async () => {
    throw new Error('Simulated network failure')
  }

  let threw = false
  let result
  try {
    result = await categoriseTransactions(manyTransactions, mockAlwaysFails)
  } catch {
    threw = true
  }

  check('does not throw even when every batch fails', !threw)
  check('all transactions reported as failed', result?.totalFailed === manyTransactions.length)
  check('batchErrors captured for diagnostics', result?.batchErrors.length === 2) // BATCH_SIZE+5 over BATCH_SIZE=40 -> 2 batches
}

async function main() {
  testPromptBuilding()
  testResponseParsing()
  testCategoryValidation()
  await testFullCategorisationFlow()
  await testPartialFailureHandling()
  await testBatchFailureIsolation()

  console.log('\n=================================')
  if (failures === 0) {
    console.log('ALL CRITICAL CHECKS PASSED')
    console.log('NOTE: these tests use a MOCKED Claude response. The live')
    console.log('API call (src/lib/anthropicClient.js) is untested — add')
    console.log('a real ANTHROPIC_API_KEY and run scripts/smoke-test-categorise.js')
    console.log('for a real end-to-end check.')
  } else {
    console.log(`${failures} CHECK(S) FAILED — review output above`)
  }
  console.log('=================================')

  process.exit(failures === 0 ? 0 : 1)
}

main()
