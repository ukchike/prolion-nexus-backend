/**
 * First Bank of Nigeria statement parser.
 *
 * CALIBRATED against a real First Bank e-statement (C And J Cosmetics
 * Ltd, Jun/Jul 2026, 5 pages). Verified: totals cross-checked against the
 * statement's own printed Opening Balance (82,519,394.22), Closing
 * Balance (112,323,590.01), Total Credit (75,772,000.00), and Total
 * Debit (45,967,804.21). Layout: each transaction starts with
 * "<Trans Date> <RefNo starting with S><description...>" and ends on a
 * line whose trailing columns are "<Value Date> <Withdrawal> <Deposit>
 * <Balance>" — either on the same line (short descriptions) or after the
 * description has wrapped across one or more additional lines. Page
 * breaks repeat the column header and interject "-- N of M --" markers,
 * which never fall inside a transaction block (always between one
 * block's trailing amounts row and the next block's start).
 */

const { normaliseDate } = require('./textHelpers')

const BLOCK_START_PATTERN = /^(\d{1,2}-[A-Za-z]{3}-\d{4})\s+(S\d+)\s+/
const TRAILING_AMOUNTS_PATTERN = /(\d{1,2}-[A-Za-z]{3}-\d{4})\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s*$/

function parseAmount(raw) {
  const value = parseFloat(raw.replace(/,/g, ''))
  return Number.isNaN(value) ? null : value
}

function isBalanceMarkerRow(text) {
  const normalised = text.trim().toLowerCase()
  return normalised.includes('opening balance') || normalised.includes('closing balance')
}

/** Turns a finished block (lines from a row-start match up to and
 * including the line whose trailing columns matched
 * TRAILING_AMOUNTS_PATTERN) into one transaction, or null if the block
 * doesn't actually have both — defensive only, since finalizeBlock is
 * never called without both having already matched at the call site. */
function finalizeBlock(blockLines) {
  const first = blockLines[0]
  const headerMatch = first.match(BLOCK_START_PATTERN)
  const last = blockLines[blockLines.length - 1]
  const amountsMatch = last.match(TRAILING_AMOUNTS_PATTERN)
  if (!headerMatch || !amountsMatch) return null

  const [, valueDateRaw, withdrawalRaw, depositRaw, balanceRaw] = amountsMatch

  const firstRemainder = first.slice(headerMatch[0].length)
  const descriptionParts = blockLines.length === 1
    ? [firstRemainder.slice(0, firstRemainder.length - amountsMatch[0].length).trim()]
    : [firstRemainder, ...blockLines.slice(1, -1), last.slice(0, last.length - amountsMatch[0].length).trim()]

  const description = descriptionParts.join(' ').replace(/\s+/g, ' ').trim()
  if (!description || isBalanceMarkerRow(description)) return null

  const withdrawal = parseAmount(withdrawalRaw)
  const deposit = parseAmount(depositRaw)
  const balance = parseAmount(balanceRaw)

  return {
    transaction_date: normaliseDate(valueDateRaw),
    description,
    debit: withdrawal > 0 ? withdrawal : null,
    credit: deposit > 0 ? deposit : null,
    balance,
  }
}

function parseFirstBankText(rawText) {
  const lines = rawText.split('\n').map((l) => l.trim()).filter((l) => l.length > 0)

  const transactions = []
  const unparsedLines = []
  let current = null

  function flushIncomplete() {
    if (current) {
      unparsedLines.push({
        line: current.join(' | '),
        reason: 'transaction block never reached its Value Date/Withdrawal/Deposit/Balance columns (often means it was cut off at a page break)',
      })
    }
    current = null
  }

  for (const line of lines) {
    if (BLOCK_START_PATTERN.test(line)) {
      flushIncomplete()
      current = [line]
    } else if (current) {
      current.push(line)
    } else {
      continue // noise before the first transaction, or a header/footer/page-marker line
    }

    if (TRAILING_AMOUNTS_PATTERN.test(current[current.length - 1])) {
      const transaction = finalizeBlock(current)
      if (transaction) transactions.push(transaction)
      current = null
    }
  }
  flushIncomplete()

  return { transactions, unparsedLines }
}

module.exports = { parseFirstBankText }
