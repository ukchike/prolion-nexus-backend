/**
 * GTBank statement parser.
 *
 * CALIBRATION NOTICE: built from common Nigerian e-statement layouts,
 * NOT yet tested against a real GTB export. Access and Zenith both
 * turned out to have completely different real layouts from this
 * assumed one — do not trust this on real GTB data until calibrated
 * the same way (upload a real statement, inspect rawTextPreview,
 * adjust). Assumed layout:
 *   <Transaction Date> <Value Date> <Description> <Debit> <Credit> <Balance>
 */

const {
  extractDates, extractAmounts, extractDescription, looksLikeTransactionLine,
} = require('./textHelpers')

function assignAmounts(amounts) {
  if (amounts.length === 0) {
    return { debit: null, credit: null, balance: null, confident: false }
  }
  if (amounts.length === 1) {
    return { debit: null, credit: null, balance: amounts[0].value, confident: false }
  }
  const balance = amounts[amounts.length - 1].value
  if (amounts.length === 2) {
    return { debit: null, credit: null, amount: amounts[0].value, balance, confident: true, ambiguousDirection: true }
  }
  const debit = amounts[0].value
  const credit = amounts.length >= 3 ? amounts[1].value : null
  return { debit, credit, balance, confident: true }
}

function parseGTBText(rawText) {
  const lines = rawText.split('\n')
  const transactions = []
  const unparsedLines = []

  for (const line of lines) {
    if (!looksLikeTransactionLine(line)) continue

    const dates = extractDates(line)
    const amounts = extractAmounts(line)
    const description = extractDescription(line, dates, amounts)
    const transactionDate = dates[0]?.normalised || null

    if (!transactionDate || amounts.length === 0 || !description) {
      unparsedLines.push({ line: line.trim(), reason: 'missing date, amount, or description' })
      continue
    }

    const { debit, credit, amount, balance, confident, ambiguousDirection } = assignAmounts(amounts)

    let finalDebit = debit
    let finalCredit = credit

    if (ambiguousDirection) {
      const isDebit = /\bDR\b/i.test(line) || /\b(withdrawal|payment|purchase|charge|debit)\b/i.test(description)
      const isCredit = /\bCR\b/i.test(line) || /\b(deposit|received|credit|transfer from)\b/i.test(description)
      if (isDebit && !isCredit) {
        finalDebit = amount
      } else if (isCredit && !isDebit) {
        finalCredit = amount
      } else {
        unparsedLines.push({ line: line.trim(), reason: 'could not determine debit vs credit direction — needs manual review' })
        continue
      }
    }

    if (!confident && balance !== null && finalDebit === null && finalCredit === null) {
      unparsedLines.push({ line: line.trim(), reason: 'only a balance was found, no movement amount' })
      continue
    }

    transactions.push({ transaction_date: transactionDate, description, debit: finalDebit, credit: finalCredit, balance })
  }

  return { transactions, unparsedLines }
}

module.exports = { parseGTBText, assignAmounts }
