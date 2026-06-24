const fs = require('fs')
const path = require('path')
const { parseStatement } = require('../src/parsers')

const EXPECTED_TRANSACTION_COUNT = 8
const EXPECTED_FINAL_BALANCE = 281496.0

let failures = 0

function check(label, condition) {
  if (condition) {
    console.log(`  PASS - ${label}`)
  } else {
    console.log(`  FAIL - ${label}`)
    failures++
  }
}

async function testCSV() {
  console.log('\n--- Testing CSV fixture ---')
  const buffer = fs.readFileSync(path.join(__dirname, 'fixtures', 'sample-statement.csv'))
  const result = await parseStatement({ buffer, fileType: 'csv' })

  console.log(`Parsed ${result.transactions.length} transactions, ${result.unparsedLines.length} unparsed lines`)
  if (result.unparsedLines.length > 0) {
    console.log('Unparsed lines:', JSON.stringify(result.unparsedLines, null, 2))
  }

  check('extracted all 8 transactions', result.transactions.length === EXPECTED_TRANSACTION_COUNT)

  const lastTxn = result.transactions[result.transactions.length - 1]
  check('final balance matches expected', lastTxn?.balance === EXPECTED_FINAL_BALANCE)

  const firstTxn = result.transactions[0]
  check('first transaction date normalised correctly', firstTxn?.transaction_date === '2025-01-01')
  check('first transaction credit captured correctly', firstTxn?.credit === 500000)
  check('first transaction debit is null (not zero)', firstTxn?.debit === null)
}

async function testPDF() {
  console.log('\n--- Testing synthetic GTB PDF fixture ---')
  const pdfPath = path.join(__dirname, 'fixtures', 'sample-gtb-statement.pdf')

  if (!fs.existsSync(pdfPath)) {
    console.log('  SKIP - PDF fixture not found. Run: node test/generate-fixture-pdf.js')
    return
  }

  const buffer = fs.readFileSync(pdfPath)

  let result
  try {
    result = await parseStatement({ buffer, fileType: 'pdf', bankCode: 'gtb' })
  } catch (err) {
    console.log(`  FAIL - PDF parsing threw an error: ${err.message}`)
    failures++
    return
  }

  console.log(`Parsed ${result.transactions.length} transactions, ${result.unparsedLines.length} unparsed lines`)
  console.log('Transactions found:', JSON.stringify(result.transactions, null, 2))
  if (result.unparsedLines.length > 0) {
    console.log('Unparsed lines:', JSON.stringify(result.unparsedLines, null, 2))
  }

  check('extracted at least 6 of 8 transactions (PDF text extraction is lossier than CSV)', result.transactions.length >= 6)

  if (result.transactions.length < EXPECTED_TRANSACTION_COUNT) {
    console.log(
      `  NOTE: only ${result.transactions.length}/${EXPECTED_TRANSACTION_COUNT} lines parsed from the synthetic PDF. ` +
      `This is expected to need tuning — see "Calibrating against a real statement" in the README. ` +
      `Inspect rawTextPreview below to see exactly what pdf-parse extracted:`
    )
    console.log('--- rawTextPreview ---')
    console.log(result.rawTextPreview)
    console.log('--- end rawTextPreview ---')
  }
}

async function testAccessRealSample() {
  console.log('\n--- Testing real Access Bank sample (RAL Paints, calibrated) ---')
  const txtPath = path.join(__dirname, 'fixtures', 'access-real-sample.txt')

  if (!fs.existsSync(txtPath)) {
    console.log('  SKIP - fixture not found.')
    return
  }

  const { parseAccessText } = require('../src/parsers/access')
  const rawText = fs.readFileSync(txtPath, 'utf-8')
  const result = parseAccessText(rawText)

  console.log(`Parsed ${result.transactions.length} transactions, ${result.unparsedLines.length} unparsed lines`)

  // 11 real transactions in this excerpt; "Opening Balance" correctly
  // excluded; transaction #13 is genuinely truncated in this fixture
  // (the source paste was cut off mid-block) so 1 unparsed line is expected.
  check('extracted all 11 real transactions', result.transactions.length === 11)
  check('exactly 1 unparsed line (the deliberately truncated final block)', result.unparsedLines.length === 1)

  const first = result.transactions[0]
  check('first transaction debit matches statement', first?.debit === 53.75)
  check('first transaction balance matches statement', first?.balance === 6095767.87)
  check('first transaction credit is null (not zero)', first?.credit === null)

  // Transaction 8->9 is a credit (lodgement) — confirms debit/credit
  // direction is read correctly, not just defaulted to debit.
  const creditTxn = result.transactions.find((t) => t.credit !== null)
  check('the one credit transaction was correctly identified as a credit', creditTxn?.credit === 2400000)
  check('credit transaction balance matches statement', creditTxn?.balance === 4093160.37)

  // Verify the balance chain is internally consistent — each balance
  // should equal the previous balance minus debit plus credit. This
  // catches sign/assignment errors that individual field checks might miss.
  let runningBalance = 6095821.62 // the excluded Opening Balance
  let chainConsistent = true
  for (const t of result.transactions) {
    const expected = runningBalance - (t.debit || 0) + (t.credit || 0)
    if (Math.abs(expected - t.balance) > 0.01) {
      chainConsistent = false
      console.log(`  Chain break at "${t.description.slice(0, 40)}...": expected ${expected}, got ${t.balance}`)
    }
    runningBalance = t.balance
  }
  check('balance chain is internally consistent across all 11 transactions', chainConsistent)
}

async function main() {
  await testCSV()
  await testPDF()
  await testAccessRealSample()

  console.log('\n=================================')
  if (failures === 0) {
    console.log('ALL CRITICAL CHECKS PASSED')
  } else {
    console.log(`${failures} CHECK(S) FAILED — review output above`)
  }
  console.log('=================================')

  process.exit(failures === 0 ? 0 : 1)
}

main()
