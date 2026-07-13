const {
  buildPrompt, parseAIResponse, validateEntry, categoriseTransactions, BATCH_SIZE,
} = require('../src/lib/categorisationEngine')
const { ALL_CATEGORIES } = require('../src/lib/categoryTaxonomy')

let failures = 0
function check(label, condition) {
  console.log(`  ${condition ? 'PASS' : 'FAIL'} - ${label}`)
  if (!condition) failures++
}

const SAMPLE = [
  { id: 'txn-1', description: 'TRANSFER FROM DANGOTE AGRO LTD', debit: null, credit: 500000 },
  { id: 'txn-2', description: 'POS PURCHASE SHOPRITE IKEJA', debit: 15000, credit: null },
  { id: 'txn-3', description: 'PAYMENT TO STAFF SALARY JAN', debit: 120000, credit: null },
  { id: 'txn-4', description: 'SMS ALERT CHARGE', debit: 4, credit: null },
  { id: 'txn-5', description: 'VAT PAYMENT FIRS', debit: 8500, credit: null },
]

function testPrompt() {
  console.log('\n--- Prompt construction ---')
  const prompt = buildPrompt(SAMPLE)
  check('includes every transaction id', SAMPLE.every((t) => prompt.includes(t.id)))
  check('includes every category from the taxonomy', ALL_CATEGORIES.every((c) => prompt.includes(c)))
  check('labels credits correctly', prompt.includes('credit 500000'))
  check('instructs JSON-only response', prompt.toLowerCase().includes('json array'))
}

function testParsing() {
  console.log('\n--- Response parsing ---')
  const clean = '[{"id": "txn-1", "category": "Sales Revenue"}]'
  check('parses clean JSON', parseAIResponse(clean)[0].id === 'txn-1')
  check('strips ```json fences', parseAIResponse('```json\n' + clean + '\n```')[0].id === 'txn-1')
  check('strips bare ``` fences', parseAIResponse('```\n' + clean + '\n```')[0].id === 'txn-1')
  check(
    'extracts array from chatty preamble/postamble (Groq-style)',
    parseAIResponse('Sure, here you go:\n' + clean + '\nLet me know!')[0].id === 'txn-1'
  )
  let threw = false
  try { parseAIResponse('not json') } catch { threw = true }
  check('throws on invalid JSON', threw)
  threw = false
  try { parseAIResponse('{"id": "x"}') } catch { threw = true }
  check('throws on non-array JSON', threw)
}

function testValidation() {
  console.log('\n--- Category validation ---')
  const valid = validateEntry({ id: 'a', category: 'Sales Revenue' })
  check('valid category passes through', valid.category === 'Sales Revenue' && valid.category_group === 'INCOME')
  const hallucinated = validateEntry({ id: 'b', category: 'Made Up Category' })
  check('hallucinated category falls back to Uncategorised/UNCLASSIFIED',
    hallucinated.category === 'Uncategorised' && hallucinated.category_group === 'UNCLASSIFIED')
  check('missing id rejected', validateEntry({ category: 'Sales Revenue' }) === null)
  check('Bank Charges maps to EXPENSE', validateEntry({ id: 'c', category: 'Bank Charges' }).category_group === 'EXPENSE')
  check('Loan Received - Current maps to BALANCE_SHEET', validateEntry({ id: 'd', category: 'Loan Received - Current' }).category_group === 'BALANCE_SHEET')

  const confident = validateEntry({ id: 'e', category: 'Staff Salaries & Wages', confidence: 97, reason: 'Narration contains SALARY' })
  check('confidence/reason pass through when present', confident.confidence === 97 && confident.reason === 'Narration contains SALARY')
  check('metadata attached: salaries are not deductible-N/A but not-VATable', confident.deductible === true && confident.vatTreatment === 'not_applicable')

  const outOfRange = validateEntry({ id: 'f', category: 'Sales Revenue', confidence: 150 })
  check('confidence clamped to 100', outOfRange.confidence === 100)
  const negative = validateEntry({ id: 'g', category: 'Sales Revenue', confidence: -20 })
  check('confidence clamped to 0', negative.confidence === 0)

  const missingConfidence = validateEntry({ id: 'h', category: 'Sales Revenue' })
  check('missing confidence defaults to a moderate value, not a fabricated high one', missingConfidence.confidence === 60)
  check('missing reason gets a default, not blank', missingConfidence.reason.length > 0)

  const fabricatedConfidence = validateEntry({ id: 'i', category: 'Not A Real Category', confidence: 99 })
  check('hallucinated category cannot also claim high confidence', fabricatedConfidence.confidence === 0)

  const nonDeductible = validateEntry({ id: 'j', category: 'Fines & Penalties' })
  check('Fines & Penalties correctly flagged non-deductible', nonDeductible.deductible === false)
  const notExpense = validateEntry({ id: 'k', category: 'Loan Received - Current' })
  check('non-expense category has null (not applicable) deductibility, not false', notExpense.deductible === null)
}

function testTaxonomyStructure() {
  console.log('\n--- Taxonomy structure (47 categories, capped groups, FX + director treatment) ---')
  const t = require('../src/lib/categoryTaxonomy')
  check('total is exactly 47', t.ALL_CATEGORIES.length === 47)
  check('no duplicates', new Set(t.ALL_CATEGORIES).size === 47)
  check('Balance Sheet capped at 16 (director treatment folded in, no cap breach)', t.BALANCE_SHEET_CATEGORIES.length <= 16)
  check('exactly 4 Cost of Sales categories',
    t.EXPENSE_CATEGORY_DEFINITIONS.filter((d) => d.subgroup === 'COST_OF_SALES').length === 4)
  check('Operating capped at 20 (now 19 after FX Loss moved out)',
    t.EXPENSE_CATEGORY_DEFINITIONS.filter((d) => d.subgroup === 'OPERATING').length <= 20)
  check('Foreign Exchange Loss is NON_OPERATING (Dufry-driven reclassification)',
    t.CATEGORY_TO_EXPENSE_SUBGROUP['Foreign Exchange Loss'] === 'NON_OPERATING')
  check('Interest Expense STAYS in OPERATING (per explicit decision)',
    t.CATEGORY_TO_EXPENSE_SUBGROUP['Interest Expense'] === 'OPERATING')
  check('Foreign Exchange Gain is a standalone INCOME category',
    t.CATEGORY_TO_GROUP['Foreign Exchange Gain'] === 'INCOME')
  check('Other Income catch-all still present alongside FX Gain', t.ALL_CATEGORIES.includes('Other Income'))
  check('Staff & Director Loans (Advanced/Repaid) in CURRENT_ASSETS (Hamptech IFRS fix)',
    t.CATEGORY_TO_BALANCE_SHEET_SUBGROUP['Staff & Director Loans (Advanced/Repaid)'] === 'CURRENT_ASSETS')
  check('every BS category has a subgroup',
    t.BALANCE_SHEET_CATEGORIES.every((c) => !!t.CATEGORY_TO_BALANCE_SHEET_SUBGROUP[c]))
  check('every Expense category has a subgroup',
    t.EXPENSE_CATEGORIES.every((c) => !!t.CATEGORY_TO_EXPENSE_SUBGROUP[c]))
  check('Other Income NOT expanded to FIRS subtypes', !t.ALL_CATEGORIES.includes('Commission Income'))
}

function testProviderSelection() {
  console.log('\n--- Provider selection ---')
  const { getProvider, getProviderName } = require('../src/lib/aiProvider')
  const original = process.env.AI_PROVIDER
  try {
    delete process.env.AI_PROVIDER
    check('defaults to anthropic', getProviderName() === 'anthropic')
    process.env.AI_PROVIDER = 'groq'
    check('selects groq', getProvider().requiredEnvVar === 'GROQ_API_KEY')
    process.env.AI_PROVIDER = 'GROQ'
    check('case-insensitive', getProviderName() === 'groq')
    process.env.AI_PROVIDER = 'typo'
    let threw = false
    try { getProvider() } catch { threw = true }
    check('throws on unknown provider', threw)
  } finally {
    if (original === undefined) delete process.env.AI_PROVIDER
    else process.env.AI_PROVIDER = original
  }
}

async function testFlow() {
  console.log('\n--- Full flow (mocked AI) ---')
  const mockGood = async () => JSON.stringify([
    { id: 'txn-1', category: 'Sales Revenue' },
    { id: 'txn-2', category: 'Cost of Goods Sold (Purchases)' },
    { id: 'txn-3', category: 'Staff Salaries & Wages' },
    { id: 'txn-4', category: 'Bank Charges' },
    { id: 'txn-5', category: 'Tax Payments' },
  ])
  const good = await categoriseTransactions(SAMPLE, mockGood)
  check('all 5 categorised', good.totalProcessed === 5 && good.totalFailed === 0)

  const mockPartial = async () => JSON.stringify([{ id: 'txn-1', category: 'Sales Revenue' }])
  const partial = await categoriseTransactions(SAMPLE, mockPartial)
  check('partial response: 4 reported failed, not dropped', partial.totalFailed === 4)

  const many = Array.from({ length: BATCH_SIZE + 5 }, (_, i) => ({ id: `t${i}`, description: `x${i}`, debit: 1, credit: null }))
  const mockFail = async () => { throw new Error('network down') }
  let threw = false
  let failResult
  try { failResult = await categoriseTransactions(many, mockFail) } catch { threw = true }
  check('total failure does not throw', !threw)
  check('all reported failed with batch errors', failResult.totalFailed === many.length && failResult.batchErrors.length === 2)
}

async function main() {
  testPrompt()
  testParsing()
  testValidation()
  testTaxonomyStructure()
  testProviderSelection()
  await testFlow()
  console.log('\n=================================')
  console.log(failures === 0 ? 'ALL CRITICAL CHECKS PASSED' : `${failures} CHECK(S) FAILED`)
  console.log('NOTE: mocked AI responses. Live call: scripts/smoke-test-categorise.js')
  console.log('=================================')
  process.exit(failures === 0 ? 0 : 1)
}
main()
