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

async function main() {
  await testCSV()
  await testPDF()

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
