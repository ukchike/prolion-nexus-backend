const fs = require('fs')
const path = require('path')
const { parseCSVBuffer } = require('../src/parsers/csvExcelParser')
const { parseAccessText } = require('../src/parsers/access')
const { parseZenithText } = require('../src/parsers/zenith')
const { parseGenericText } = require('../src/parsers/generic')

let failures = 0
function check(label, condition) {
  console.log(`  ${condition ? 'PASS' : 'FAIL'} - ${label}`)
  if (!condition) failures++
}

function testCSV() {
  console.log('\n--- CSV parsing (synthetic fixture) ---')
  const buffer = fs.readFileSync(path.join(__dirname, 'fixtures/sample-statement.csv'))
  const { transactions, unparsedLines } = parseCSVBuffer(buffer)
  check('8 transactions parsed', transactions.length === 8)
  check('no unparsed lines', unparsedLines.length === 0)
  check('first transaction is the Dangote credit', transactions[0].credit === 500000 && transactions[0].debit === null)
  check('dates normalised to ISO', transactions[0].transaction_date === '2025-01-01')
}

function testAccessReal() {
  console.log('\n--- Access Bank (REAL statement sample) ---')
  const text = fs.readFileSync(path.join(__dirname, 'fixtures/access-real-sample.txt'), 'utf-8')
  const { transactions, unparsedLines } = parseAccessText(text)
  check('11 transactions parsed from the real sample', transactions.length === 11)
  check('1 unparsed (the cut-off block at the end of the page)', unparsedLines.length === 1)
  check('the ₦4,164,000 RALPAINTS withdrawal parsed correctly', !!transactions.find((t) => t.debit === 4164000))
  check('the ₦2,400,000 Zenith cheque deposit parsed as a credit', !!transactions.find((t) => t.credit === 2400000))
  check('opening balance row skipped (not a transaction)', !transactions.some((t) => /opening balance/i.test(t.description)))
}

function testZenithReal() {
  console.log('\n--- Zenith Bank (REAL statement sample) ---')
  const text = fs.readFileSync(path.join(__dirname, 'fixtures/zenith-real-sample.txt'), 'utf-8')
  const { transactions, unparsedLines } = parseZenithText(text)
  check('6 transactions parsed from the real sample', transactions.length === 6)
  check('no unparsed blocks', unparsedLines.length === 0)
  const totalDebits = transactions.reduce((s, t) => s + (t.debit || 0), 0)
  const totalCredits = transactions.reduce((s, t) => s + (t.credit || 0), 0)
  check('total debits match the statement footer exactly (6,405,365.78)', Math.abs(totalDebits - 6405365.78) < 0.01)
  check('total credits match the statement footer exactly (1,719,216.97)', Math.abs(totalCredits - 1719216.97) < 0.01)
  check('closing balance matches footer (735,974.22)', Math.abs(transactions[transactions.length - 1].balance - 735974.22) < 0.01)
  check('the one credit transaction was correctly identified (not as a debit)', transactions.filter((t) => t.credit).length === 1)
}

function testGenericParser() {
  console.log('\n--- Generic multi-layout parser (4 families + edge cases) ---')

  const wallet = parseGenericText('03 Jun 2026 USSD*AIRTIME PURCHASE-0803XXXXXXX 604,043.09 DEBIT 4,235,989.19')
  check('WALLET family: debit parsed', wallet.transactions[0]?.debit === 604043.09)
  check('WALLET family: date normalised to ISO', wallet.transactions[0]?.transaction_date === '2026-06-03')

  const transvalue = parseGenericText('04-Jun-2026 04-Jun-2026 INTEREST ON SAVINGS - 2,575,076.37 5,799,187.54')
  check('TRANSVALUE family: "-" debit slot -> null, credit parsed', transvalue.transactions[0]?.debit === null && transvalue.transactions[0]?.credit === 2575076.37)

  const jammed = parseGenericText('28-Jun-26 REF054659 NIP TRF TO STERLING CEMENT SUPPLIES LTD198,057.18 - 13,268,032.41')
  check('REFERENCE family: amount jammed against description splits correctly', jammed.transactions[0]?.debit === 198057.18)
  check('REFERENCE family: description clean of the jammed amount', jammed.transactions[0]?.description === 'NIP TRF TO STERLING CEMENT SUPPLIES LTD')

  const narration = parseGenericText('04/06/2026 ATM WITHDRAWAL-VICTORIA ISLAND BRANCH 474,540.40 - 2,525,316.68')
  check('NARRATION family: withdrawal parsed as debit', narration.transactions[0]?.debit === 474540.4)

  const negative = parseGenericText('10 Jun 2026 STAMP DUTY CHARGE 860,809.50 DEBIT -845,634.01')
  check('negative (overdrawn) balance parsed', negative.transactions[0]?.balance === -845634.01)

  const reversal = parseGenericText('18-Jun-2026 18-Jun-2026 REVERSAL-FAILED POS TXN - 1,044,879.98 -276,415.81')
  check('reversal credit with negative balance parsed', reversal.transactions[0]?.credit === 1044879.98 && reversal.transactions[0]?.balance === -276415.81)

  const headerNoise = parseGenericText('Date Transaction Details Amount (NGN) Type Balance (NGN)\nOpening Balance Total Credit Total Debit Closing Balance\nNGN 2,507,171.29 NGN 15,367,722.34 NGN 4,211,868.98 NGN 13,663,024.65')
  check('header/totals rows produce zero transactions and zero unparsed noise', headerNoise.transactions.length === 0 && headerNoise.unparsedLines.length === 0)
}

testCSV()
testAccessReal()
testZenithReal()
testGenericParser()

console.log('\n=================================')
console.log(failures === 0 ? 'ALL CRITICAL CHECKS PASSED' : `${failures} CHECK(S) FAILED`)
console.log('=================================')
process.exit(failures === 0 ? 0 : 1)
