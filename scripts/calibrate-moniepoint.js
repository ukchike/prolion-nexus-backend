/**
 * Calibration harness for the Moniepoint parser.
 *
 * Ticks the parse back to the statement's OWN summary box — the same
 * discipline as agreeing a statement to its footer in an audit — and then
 * walks the balance chain, which is the stricter test: totals can agree while
 * individual rows are wrong, but the chain only closes if every single
 * movement is right.
 *
 * The chain check has to reorder first. Moniepoint prints postings that share
 * a timestamp (a transfer plus its VAT and stamp duty) in an arbitrary order
 * within the group, so a naive walk in file order reports drift that is not
 * there. Each same-timestamp group is reordered to the sequence that fits the
 * balances before comparing.
 *
 * Usage: node scripts/calibrate-moniepoint.js /path/to/statement.pdf
 */

const fs = require('fs')
const { extractTextFromPDF } = require('../src/parsers/pdfTextExtractor')
const { parseMoniepointText, parseSummary } = require('../src/parsers/moniepoint')

const pdfPath = process.argv[2]
if (!pdfPath) {
  console.error('Usage: node scripts/calibrate-moniepoint.js /path/to/statement.pdf')
  process.exit(1)
}

const money = (n) => (n === null || n === undefined
  ? '—'
  : n.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
const round = (n) => Math.round(n * 100) / 100

/** Greedily orders a same-timestamp group so each row's Balance follows from
 *  the one before. Returns null when no ordering fits, which is a real finding
 *  rather than something to paper over. */
function orderGroup(group, openingBalance) {
  const remaining = [...group]
  const ordered = []
  let balance = openingBalance
  while (remaining.length > 0) {
    const at = remaining.findIndex((t) => {
      const movement = t.credit ? t.credit : -t.debit
      return Math.abs(round(balance + movement) - t.balance) < 0.005
    })
    if (at === -1) return null
    const [next] = remaining.splice(at, 1)
    ordered.push(next)
    balance = next.balance
  }
  return ordered
}

;(async () => {
  const buffer = fs.readFileSync(pdfPath)
  const rawText = await extractTextFromPDF(buffer)
  const summary = parseSummary(rawText)
  const { transactions, unparsedLines } = parseMoniepointText(rawText)

  const debitTotal = round(transactions.reduce((s, t) => s + (t.debit || 0), 0))
  const creditTotal = round(transactions.reduce((s, t) => s + (t.credit || 0), 0))
  const impliedClosing = round(summary.openingBalance + creditTotal - debitTotal)

  const checks = []
  const check = (name, actual, expected) => {
    const ok = expected !== null && Math.abs(round(actual - expected)) < 0.005
    checks.push({ name, actual, expected, ok, delta: expected === null ? null : round(actual - expected) })
  }

  console.log(`\nMoniepoint calibration — ${pdfPath}`)
  console.log(`  rows parsed:        ${transactions.length}`)
  console.log(`  rows unparsed:      ${unparsedLines.length}`)
  console.log(`  debits / credits:   ${transactions.filter((t) => t.debit).length} / ${transactions.filter((t) => t.credit).length}`)
  console.log(`  reversals flagged:  ${transactions.filter((t) => /\(reversal\)/.test(t.description)).length}`)

  check('Total debits vs statement', debitTotal, summary.totalDebits)
  check('Total credits vs statement', creditTotal, summary.totalCredits)
  check('Opening + credits − debits = closing', impliedClosing, summary.closingBalance)

  // Last row's printed balance must be the statement's closing balance. Taken
  // from the chain-ordered rows, not file order, for the reason above.
  const groups = new Map()
  for (const t of transactions) {
    const key = t.transaction_date
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(t)
  }

  let balance = summary.openingBalance
  let chainBroken = 0
  let unorderable = 0
  const sortedDates = [...groups.keys()].sort()
  for (const date of sortedDates) {
    const ordered = orderGroup(groups.get(date), balance)
    if (!ordered) {
      unorderable += groups.get(date).length
      // Fall back to file order so the walk can continue and report the rest.
      for (const t of groups.get(date)) {
        const movement = t.credit ? t.credit : -t.debit
        if (Math.abs(round(balance + movement) - t.balance) >= 0.005) chainBroken += 1
        balance = t.balance
      }
      continue
    }
    for (const t of ordered) balance = t.balance
  }

  check('Balance chain end vs closing', round(balance), summary.closingBalance)

  console.log('\n  statement summary box:')
  console.log(`    opening ${money(summary.openingBalance)}   debits ${money(summary.totalDebits)}   credits ${money(summary.totalCredits)}   closing ${money(summary.closingBalance)}`)
  console.log('\n  checks:')
  for (const c of checks) {
    console.log(`    ${c.ok ? 'PASS' : 'FAIL'}  ${c.name.padEnd(38)} parsed ${money(c.actual).padStart(17)}  printed ${money(c.expected).padStart(17)}  delta ${money(c.delta)}`)
  }
  console.log(`    ${chainBroken === 0 ? 'PASS' : 'FAIL'}  ${'Per-row balance steps'.padEnd(38)} ${chainBroken} broken step(s), ${unorderable} row(s) in unorderable groups`)

  if (unparsedLines.length > 0) {
    console.log('\n  unparsed rows:')
    for (const u of unparsedLines.slice(0, 15)) console.log(`    - ${u.reason}: ${u.line.slice(0, 110)}`)
  }

  const failed = checks.filter((c) => !c.ok).length + (chainBroken === 0 ? 0 : 1)
  console.log(`\n  ${failed === 0 ? 'ALL CHECKS PASS' : `${failed} CHECK(S) FAILED`}\n`)
  process.exit(failed === 0 ? 0 : 1)
})().catch((err) => { console.error(err); process.exit(1) })
