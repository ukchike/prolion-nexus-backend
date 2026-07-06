/**
 * Calibration harness: splits the merged specimen PDF text into
 * individual statements, parses each with the generic parser, and
 * reconciles parsed totals against the statement's OWN printed control
 * figures (Total Credit, Total Debit, Closing Balance) — the same
 * discipline as ticking a statement back to its footer in an audit.
 *
 * Usage: node scripts/calibration-run.js /path/to/raw-extracted-text.txt
 */

const fs = require('fs')
const { parseGenericText } = require('../src/parsers/generic')

const rawPath = process.argv[2] || '/home/claude/calibration-raw.txt'
const raw = fs.readFileSync(rawPath, 'utf-8')

// Each statement page starts with the SPECIMEN banner; the bank name is
// the first ALL-CAPS line after the banner's two fixed lines.
const sections = raw.split(/SPECIMEN - TEST DATA/).map((s) => s.trim()).filter(Boolean)

const AMT = /-?[\d,]+\.\d{2}/g

function printedTotals(sectionText) {
  // The control row is: "NGN <opening> NGN <credit> NGN <debit> NGN <closing>"
  const m = sectionText.match(/NGN\s+(-?[\d,]+\.\d{2})\s+NGN\s+(-?[\d,]+\.\d{2})\s+NGN\s+(-?[\d,]+\.\d{2})\s+NGN\s+(-?[\d,]+\.\d{2})/)
  if (!m) return null
  const [, opening, credit, debit, closing] = m.map((x) => (typeof x === 'string' ? parseFloat(x.replace(/,/g, '')) : x))
  return { opening, credit, debit, closing }
}

function bankName(sectionText) {
  const lines = sectionText.split('\n').map((l) => l.trim())
  // line 0 is the "computer-generated SAMPLE..." disclaimer; bank name follows
  return lines.find((l, i) => i > 0 && /^[A-Z][A-Z\s&.-]+$/.test(l) && l.length > 3) || 'UNKNOWN'
}

let pass = 0
let fail = 0
const failures = []

console.log('Bank'.padEnd(38), 'Txns', 'Credits-match', 'Debits-match', 'Closing-match')
console.log('-'.repeat(95))

for (const section of sections) {
  const totals = printedTotals(section)
  if (!totals) continue
  const name = bankName(section)

  const { transactions, unparsedLines } = parseGenericText(section)

  const sumCredits = transactions.reduce((s, t) => s + (t.credit || 0), 0)
  const sumDebits = transactions.reduce((s, t) => s + (t.debit || 0), 0)
  const lastBalance = transactions.length ? transactions[transactions.length - 1].balance : null

  const creditsOk = Math.abs(sumCredits - totals.credit) < 0.01
  const debitsOk = Math.abs(sumDebits - totals.debit) < 0.01
  const closingOk = lastBalance !== null && Math.abs(lastBalance - totals.closing) < 0.01
  const allOk = creditsOk && debitsOk && closingOk && unparsedLines.length === 0

  console.log(
    name.padEnd(38),
    String(transactions.length).padEnd(4),
    (creditsOk ? 'YES' : 'NO ').padEnd(13),
    (debitsOk ? 'YES' : 'NO ').padEnd(12),
    closingOk ? 'YES' : 'NO'
  )

  if (allOk) pass++
  else {
    fail++
    failures.push({
      name,
      expected: totals,
      got: { sumCredits, sumDebits, lastBalance },
      unparsed: unparsedLines,
    })
  }
}

console.log('-'.repeat(95))
console.log(`RESULT: ${pass} statements fully reconciled, ${fail} failed`)

if (failures.length > 0) {
  console.log('\n=== FAILURE DETAIL ===')
  for (const f of failures) {
    console.log(`\n${f.name}`)
    console.log('  expected:', JSON.stringify(f.expected))
    console.log('  got:     ', JSON.stringify(f.got))
    for (const u of f.unparsed.slice(0, 5)) console.log('  unparsed:', u.line.slice(0, 100))
  }
}

process.exit(fail === 0 ? 0 : 1)
