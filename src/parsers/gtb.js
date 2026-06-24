/**
 * GTBank statement parser.
 *
 * CALIBRATION NOTICE: built from common Nigerian e-statement layouts,
 * not yet tested against a real GTB export. The assumed layout is:
 *
 *   <Transaction Date> <Value Date> <Description> <Debit> <Credit> <Balance>
 *
 * with either Debit or Credit blank (not zero) on any given line. Some
 * GTB exports use a single date column instead of two — this parser
 * handles both cases. If your real statement uses a different column
 * order, adjust `assignAmounts()` below — that is the only function
 * that needs to change for a layout variation.
 */

const {
  extractDates,
  extractAmounts,
  extractDescription,
  looksLikeTransactionLine,
} = require('./textHelpers')

/**
 * Given the list of amounts found on a line (in left-to-right order),
 * decide which is debit, which is credit, and which is the running
 * balance. This is the part most likely to need tuning per bank.
 *
 * Assumption: the LAST amount on the line is always the running balance
 * (this is true for the overwhelming majority of Nigerian bank exports).
 * The amount(s) before it are debit and/or credit.
 */
function assignAmounts(amounts) {
  if (amounts.length === 0) {
    return { debit: null, credit: null, balance: null, confident: false }
  }

  if (amounts.length === 1) {
    // Only a balance was found — no movement amount on this line.
    // This usually means the line didn't fully match; flag as low confidence.
    return { debit: null, credit: null, balance: amounts[0].value, confident: false }
  }

  const balance = amounts[amounts.length - 1].value

  if (amounts.length === 2) {
    // One movement amount + balance. We cannot tell debit from credit
    // purely from position — the line text (DR/CR marker) should be
    // checked by the caller. Default to crediting it as "unsigned" and
    // let the caller's DR/CR check override.
    return { debit: null, credit: null, amount: amounts[0].value, balance, confident: true, ambiguousDirection: true }
  }

  // 3+ amounts: assume [debit, credit, balance] with the middle values
  // representing whichever of debit/credit had values on this line.
  // Most real exports have exactly one of debit/credit populated, so with
  // 3 numbers we treat the first as debit and second as credit IF both
  // are non-zero; if amounts.length is exactly 3, that's the clean case.
  const debit = amounts[0].value
  const credit = amounts.length >= 3 ? amounts[1].value : null
  return { debit, credit, balance, confident: true }
}

/**
 * Parses raw extracted PDF text (already split by the caller is NOT
 * required — this function does its own line splitting) into an array
 * of transaction objects plus a list of lines that looked relevant but
 * could not be confidently parsed (for the user to review).
 */
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
      // Use DR/CR marker in the original line, or fall back to keyword
      // heuristics on the description, to decide direction.
      const isDebit = /\bDR\b/i.test(line) || /\b(withdrawal|payment|purchase|charge|debit)\b/i.test(description)
      const isCredit = /\bCR\b/i.test(line) || /\b(deposit|received|credit|transfer from)\b/i.test(description)
      if (isDebit && !isCredit) {
        finalDebit = amount
      } else if (isCredit && !isDebit) {
        finalCredit = amount
      } else {
        // Genuinely ambiguous — flag for manual review rather than guess wrong
        unparsedLines.push({
          line: line.trim(),
          reason: 'could not determine debit vs credit direction — needs manual review',
        })
        continue
      }
    }

    if (!confident && balance !== null && finalDebit === null && finalCredit === null) {
      unparsedLines.push({ line: line.trim(), reason: 'only a balance was found, no movement amount' })
      continue
    }

    transactions.push({
      transaction_date: transactionDate,
      description,
      debit: finalDebit,
      credit: finalCredit,
      balance,
    })
  }

  return { transactions, unparsedLines }
}

module.exports = { parseGTBText, assignAmounts }
