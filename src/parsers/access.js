/**
 * Access Bank statement parser.
 *
 * Access Bank has (at least) two different statement export layouts,
 * so this tries both in turn:
 *
 * FORMAT 1 — "block" layout, CALIBRATED against a real branch-issued
 * statement (RAL Paints Ltd, June 2026). Verified in production: 117
 * real transactions parsed and saved. Each transaction spans MULTIPLE
 * lines:
 *   1. "<S/NO> <DD-Mon->" + "<YYYY>"  (wrapped date header)
 *   2. description text (1+ lines, wraps freely)
 *   3. reference number (1+ lines)
 *   4. "<DD-Mon-YYYY> <withdrawal> <lodgement> <balance>" (value date row)
 *
 * FORMAT 2 — "tab" layout, calibrated against a real internet-banking
 * self-service statement export (KINGSLEY CHIKE UZOKA, Jan 2025–Jul
 * 2026, 11 pages). Every transaction is
 * "<Posted Date>\t<Value Date>\t<Description...>\t<Debit>\t<Credit>\t<Balance>"
 * — either all on one line, or with the description wrapping across
 * additional lines before the trailing Debit/Credit/Balance columns
 * appear. "-" marks an empty Debit or Credit cell.
 */

const { normaliseDate } = require('./textHelpers')

const BLOCK_START_PATTERN = /^\d+\s+(\d{1,2}-[A-Za-z]{3}-\d{4})\s*$/
const WRAPPED_DATE_FIRST_HALF = /^(\d+)\s+(\d{1,2}-[A-Za-z]{3})-\s*$/
const WRAPPED_DATE_SECOND_HALF = /^(\d{4})\s*$/
const DATA_ROW_PATTERN = /^(\d{1,2}-[A-Za-z]{3}-\d{4})\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s*$/

// FORMAT 2 patterns — tab-separated columns, real \t characters (this
// export is table-structured in the source PDF, unlike Format 1's
// free-flowing text).
const TAB_ROW_START = /^(\d{1,2}-[A-Za-z]{3}-\d{2,4})\s*\t\s*(\d{1,2}-[A-Za-z]{3}-\d{2,4})/
// The leading boundary before the Debit column is either a tab (when
// description text remains on this same line) or the start of the
// line itself (when the description fully wrapped onto earlier lines,
// leaving this line as just the trailing Debit/Credit/Balance columns).
const TAB_TRAILING_AMOUNTS = /(?:^|\t)\s*(-|[\d,]+\.\d{2})\s*\t\s*(-|[\d,]+\.\d{2})\s*\t\s*([\d,]+\.\d{2})\s*$/
const TAB_SKIP_LINE = /^(Posted Date\s*\t|--\s*\d+\s+of\s+\d+\s*--$)/i

function parseAmount(raw) {
  const value = parseFloat(raw.replace(/,/g, ''))
  return Number.isNaN(value) ? null : value
}

function mergeWrappedDateHeaders(lines) {
  const merged = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const firstHalf = line.match(WRAPPED_DATE_FIRST_HALF)
    const nextLine = lines[i + 1] || ''
    const secondHalf = firstHalf ? nextLine.match(WRAPPED_DATE_SECOND_HALF) : null
    if (firstHalf && secondHalf) {
      merged.push(`${firstHalf[1]} ${firstHalf[2]}-${secondHalf[1]}`)
      i++
    } else {
      merged.push(line)
    }
  }
  return merged
}

function splitIntoBlocks(lines) {
  const blocks = []
  let current = null
  for (const line of lines) {
    if (BLOCK_START_PATTERN.test(line)) {
      if (current) blocks.push(current)
      current = { headerLine: line, bodyLines: [] }
    } else if (current) {
      current.bodyLines.push(line)
    }
  }
  if (current) blocks.push(current)
  return blocks
}

function isBalanceMarkerRow(text) {
  const normalised = text.trim().toLowerCase()
  return normalised.includes('opening balance') || normalised.includes('closing balance')
}

function parseAccessBlockFormat(rawText) {
  const rawLines = rawText.split('\n').map((l) => l.trim()).filter((l) => l.length > 0)
  const mergedLines = mergeWrappedDateHeaders(rawLines)
  const blocks = splitIntoBlocks(mergedLines)

  const transactions = []
  const unparsedLines = []

  for (const block of blocks) {
    const fullBlockText = block.bodyLines.join(' ')

    if (isBalanceMarkerRow(fullBlockText)) continue

    const dataRowIndex = block.bodyLines.findIndex((l) => DATA_ROW_PATTERN.test(l))

    if (dataRowIndex === -1) {
      unparsedLines.push({
        line: `${block.headerLine} | ${fullBlockText}`,
        reason: 'no value-date/withdrawal/lodgement/balance row found in this transaction block (often means the block got cut off, e.g. at the end of a page)',
      })
      continue
    }

    const dataRowMatch = block.bodyLines[dataRowIndex].match(DATA_ROW_PATTERN)
    const [, valueDateRaw, withdrawalRaw, lodgementRaw, balanceRaw] = dataRowMatch

    const description = block.bodyLines.slice(0, dataRowIndex).join(' ').replace(/\s+/g, ' ').trim()

    if (!description) {
      unparsedLines.push({ line: `${block.headerLine} | ${fullBlockText}`, reason: 'data row found but no description text in this block' })
      continue
    }

    const withdrawal = parseAmount(withdrawalRaw)
    const lodgement = parseAmount(lodgementRaw)
    const balance = parseAmount(balanceRaw)

    transactions.push({
      transaction_date: normaliseDate(valueDateRaw),
      description,
      debit: withdrawal > 0 ? withdrawal : null,
      credit: lodgement > 0 ? lodgement : null,
      balance,
    })
  }

  return { transactions, unparsedLines }
}

/** Turns a finished tab-format block (the lines from a row-start match
 * up to and including the line whose trailing columns matched
 * TAB_TRAILING_AMOUNTS) into one transaction, or null if the block
 * doesn't actually have both a valid date and a valid amounts row —
 * defensive only, since finalizeTabBlock is never called without both
 * having already matched at the call site. */
function finalizeTabBlock(blockLines) {
  const first = blockLines[0]
  const dateMatch = first.match(TAB_ROW_START)
  const last = blockLines[blockLines.length - 1]
  const amountsMatch = last.match(TAB_TRAILING_AMOUNTS)
  if (!dateMatch || !amountsMatch) return null

  const [, , valueDateRaw] = dateMatch
  const [, debitRaw, creditRaw, balanceRaw] = amountsMatch

  const firstRemainder = first.slice(dateMatch[0].length).trim()
  const descriptionParts = blockLines.length === 1
    ? [firstRemainder.slice(0, firstRemainder.length - amountsMatch[0].length).trim()]
    : [firstRemainder, ...blockLines.slice(1, -1), last.slice(0, last.length - amountsMatch[0].length).trim()]

  const description = descriptionParts.join(' ').replace(/\s+/g, ' ').trim()
  if (isBalanceMarkerRow(description)) return null

  const debit = parseAmount(debitRaw)
  const credit = parseAmount(creditRaw)
  const balance = parseAmount(balanceRaw)

  return {
    transaction_date: normaliseDate(valueDateRaw),
    description,
    debit: debit > 0 ? debit : null,
    credit: credit > 0 ? credit : null,
    balance,
  }
}

function parseAccessTabFormat(rawText) {
  // Only trim trailing whitespace, not leading — TAB_ROW_START and
  // TAB_TRAILING_AMOUNTS both anchor on real \t characters, which
  // JS's plain .trim() would also strip from the wrong end otherwise.
  const lines = rawText.split('\n').map((l) => l.replace(/\s+$/, '')).filter((l) => l.trim().length > 0)

  const transactions = []
  const unparsedLines = []
  let current = null

  function flushIncomplete() {
    if (current) {
      unparsedLines.push({
        line: current.join(' | '),
        reason: 'transaction block never reached its Debit/Credit/Balance columns (often means it was cut off at a page break)',
      })
    }
    current = null
  }

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (TAB_SKIP_LINE.test(line)) continue // repeated table header / page marker, never real content

    if (TAB_ROW_START.test(line)) {
      flushIncomplete()
      current = [line]
    } else if (current) {
      current.push(line)
    } else {
      continue // noise before the first transaction (statement header block)
    }

    if (TAB_TRAILING_AMOUNTS.test(current[current.length - 1])) {
      const transaction = finalizeTabBlock(current)
      if (transaction) transactions.push(transaction)
      current = null
    }
  }
  flushIncomplete()

  return { transactions, unparsedLines }
}

function parseAccessText(rawText) {
  const blockResult = parseAccessBlockFormat(rawText)
  if (blockResult.transactions.length > 0) return blockResult
  return parseAccessTabFormat(rawText)
}

module.exports = { parseAccessText }
