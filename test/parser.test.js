const fs = require('fs')
const path = require('path')
const { parseCSVBuffer } = require('../src/parsers/csvExcelParser')
const { parseAccessText } = require('../src/parsers/access')
const { parseZenithText } = require('../src/parsers/zenith')
const { parseFirstBankText } = require('../src/parsers/firstbank')
const { parseProvidusText } = require('../src/parsers/providus')
const { parseMoniepointText, parseSummary } = require('../src/parsers/moniepoint')
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

function testAccessTabFormat() {
  console.log('\n--- Access Bank (tab-separated internet-banking export) ---')
  const text = fs.readFileSync(path.join(__dirname, 'fixtures/access-tab-format-sample.txt'), 'utf-8')
  const { transactions, unparsedLines } = parseAccessText(text)
  check('4 transactions parsed (opening balance row excluded)', transactions.length === 4)
  check('no unparsed lines', unparsedLines.length === 0)
  check('opening balance row skipped (not a transaction)', !transactions.some((t) => /opening balance/i.test(t.description)))
  check('single-line transaction parsed (levy debit 50)', !!transactions.find((t) => t.debit === 50))
  check(
    '3-line wrapped transaction (dates-only header line) parsed with description stitched back together',
    !!transactions.find((t) => t.debit === 50026.88 && t.description === 'TRF/Chike/FRM ADAEZE CHUKWU TO ADAEZE CHUKWU- C03')
  )
  check('single-line credit transaction parsed', !!transactions.find((t) => t.credit === 50000))
  check(
    '4-line wrapped transaction (amounts-only trailing line, no leading tab) parsed correctly',
    !!transactions.find((t) => t.credit === 150000 && t.description === "TRF/18QueensDrive 4thQtr2024AcctgServices/TO ADAEZE CHUKWU FROM OL' MANS COVE VENTURES")
  )
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

function testFirstBankReal() {
  console.log('\n--- First Bank (REAL statement sample, 5 pages) ---')
  const text = fs.readFileSync(path.join(__dirname, 'fixtures/firstbank-real-sample.txt'), 'utf-8')
  const { transactions, unparsedLines } = parseFirstBankText(text)
  check('120 transactions parsed from the real sample', transactions.length === 120)
  check('no unparsed blocks', unparsedLines.length === 0)
  const totalDebits = transactions.reduce((s, t) => s + (t.debit || 0), 0)
  const totalCredits = transactions.reduce((s, t) => s + (t.credit || 0), 0)
  check('total debits match the statement footer exactly (45,967,804.21)', Math.abs(totalDebits - 45967804.21) < 0.01)
  check('total credits match the statement footer exactly (75,772,000.00)', Math.abs(totalCredits - 75772000) < 0.01)
  check('closing balance matches footer (112,323,590.01)', Math.abs(transactions[transactions.length - 1].balance - 112323590.01) < 0.01)
  check('opening/closing balance rows skipped (not transactions)', !transactions.some((t) => /opening balance|closing balance/i.test(t.description)))
  check(
    'a wrapped 2-line "Stamp Duty Charge" block parsed correctly (debit 100)',
    !!transactions.find((t) => t.debit === 100 && /Stamp Duty Charge/i.test(t.description))
  )
}

function testProvidusReal() {
  console.log('\n--- Providus Bank (REAL statement sample, 24 pages) ---')
  const text = fs.readFileSync(path.join(__dirname, 'fixtures/providus-real-sample.txt'), 'utf-8')
  const { transactions, unparsedLines } = parseProvidusText(text)
  check('519 transactions parsed from the real sample', transactions.length === 519)
  check('no unparsed blocks', unparsedLines.length === 0)
  check('274 debit / 245 credit, matching the statement footer DEB./CRED. COUNT exactly', transactions.filter((t) => t.debit != null).length === 274 && transactions.filter((t) => t.credit != null).length === 245)
  const totalCredits = transactions.reduce((s, t) => s + (t.credit || 0), 0)
  check('total credits match the statement footer exactly (22,151,852.00)', Math.abs(totalCredits - 22151852) < 0.01)
  check('closing balance matches footer (14,246,895.90)', Math.abs(transactions[transactions.length - 1].balance - 14246895.9) < 0.01)
  let runningBalance = 7808662.13
  const balanceChainBroken = transactions.some((t) => {
    const expected = runningBalance + (t.credit || 0) - (t.debit || 0)
    runningBalance = t.balance
    return Math.abs(expected - t.balance) > 0.01
  })
  check('every transaction reconstructs the running balance chain from OPENING BAL. with zero drift', !balanceChainBroken)
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

function testMoniepointLayout() {
  console.log('\n--- Moniepoint (layout fixture, anonymised) ---')
  // The fixture reproduces the real statement's LAYOUT exactly — including
  // every trap below — with invented names and account numbers, because the
  // calibration statement is a third party's and its counterparties are named
  // individuals. Reconciliation against the real 97-page export lives in
  // scripts/calibrate-moniepoint.js.
  const text = fs.readFileSync(path.join(__dirname, 'fixtures/moniepoint-layout-sample.txt'), 'utf-8')
  const { transactions, unparsedLines } = parseMoniepointText(text)
  const summary = parseSummary(text)

  check('5 transactions parsed', transactions.length === 5)
  check('no unparsed lines', unparsedLines.length === 0)

  // The summary box's labels wrap across lines ("Opening" / "Balance 1,000.00").
  check('summary opening balance read', summary.openingBalance === 1000)
  check('summary total debits read', summary.totalDebits === 10071.5)
  check('summary total credits read', summary.totalCredits === 50050)
  check('summary closing balance read', summary.closingBalance === 40978.5)

  // Trap 1: the timestamp is split across two lines, and the split point
  // varies. Neither form may leak digits into the description.
  const vat = transactions.find((t) => t.description === 'Value Added Tax')
  check('HH: + MM split leaves a clean description', !!vat && vat.debit === 1.5)
  const stamp = transactions.find((t) => t.description === 'Stamp duty')
  check('HH: + MM:SS split leaves a clean description', !!stamp && stamp.debit === 50)

  // Trap 2: a reversal's reference says _DEBIT_ while the money is a CREDIT.
  // Reading the suffix instead of the columns books it backwards.
  const reversal = transactions.find((t) => /reversal/.test(t.description))
  check('reversal is booked as a CREDIT, not a debit', !!reversal && reversal.credit === 50 && reversal.debit === null)
  check('reversal keeps a readable note', !!reversal && reversal.description === 'Stamp duty (reversal)')

  // Multi-line narration, and a page marker landing between two rows.
  const transfer = transactions.find((t) => t.debit === 10020)
  check('multi-line narration is joined', !!transfer && /TRANSFER TO EXAMPLE COUNTERPARTY NAME/.test(transfer.description))
  check('page markers are not treated as narration', !transactions.some((t) => /\d+ of \d+/.test(t.description)))

  // The machine reference is stripped from what the user reads.
  check('reference is not left in the description', !transactions.some((t) => /_DEBIT_|_CREDIT_/.test(t.description)))

  check('dates are ISO', transactions.every((t) => /^\d{4}-\d{2}-\d{2}$/.test(t.transaction_date)))

  // The fixture ticks back to its own summary box, same discipline as the
  // real-statement calibration.
  const debitTotal = Math.round(transactions.reduce((s2, t) => s2 + (t.debit || 0), 0) * 100) / 100
  const creditTotal = Math.round(transactions.reduce((s2, t) => s2 + (t.credit || 0), 0) * 100) / 100
  check('parsed debits agree with the summary box', debitTotal === summary.totalDebits)
  check('parsed credits agree with the summary box', creditTotal === summary.totalCredits)
  check('opening + credits - debits = closing', Math.round((summary.openingBalance + creditTotal - debitTotal) * 100) / 100 === summary.closingBalance)

  // A Moniepoint export yields NOTHING under the generic engine, which is why
  // it needs its own parser and why index.js falls back from 'auto' to the
  // bank-specific parsers.
  check('generic engine does not claim this layout', parseGenericText(text).transactions.length === 0)
}

testCSV()
testAccessReal()
testAccessTabFormat()
testZenithReal()
testFirstBankReal()
testProvidusReal()
testMoniepointLayout()
testGenericParser()

console.log('\n=================================')
console.log(failures === 0 ? 'ALL CRITICAL CHECKS PASSED' : `${failures} CHECK(S) FAILED`)
console.log('=================================')
process.exit(failures === 0 ? 0 : 1)
