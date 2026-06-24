/**
 * Access Bank statement parser.
 *
 * CALIBRATED against a real Access Bank statement (RAL Paints Ltd,
 * June 2026 — supplied during Sprint 1 testing). Access Bank's PDF
 * export uses a fundamentally different layout from GTB's assumed
 * single-line-per-transaction format. Each transaction spans MULTIPLE
 * lines, in this order:
 *
 *   1. "<S/NO> <DD-Mon->"   <- transaction date, almost always WRAPPED
 *      "<YYYY>"                across two lines because the PDF's date
 *                              column is too narrow for "DD-Mon-YYYY"
 *   2. <description text>   <- 1+ lines, wraps freely, no fixed length
 *   3. <reference number>   <- 1+ lines, wraps freely, often ends with
 *                              a trailing underscore "_" when continued
 *   4. "<DD-Mon-YYYY> <withdrawal> <lodgement> <balance>"
 *                            <- always exactly one line, never wraps —
 *                               this is the VALUE DATE row, which can
 *                               differ from the transaction date in
 *                               section 1 (e.g. weekend clearing delay)
 *
 * Design decisions worth knowing about if you're tuning this further:
 *
 * - `transaction_date` is taken from the VALUE DATE row (section 4),
 *   not the transaction date in the header (section 1). They're
 *   usually the same day but occasionally differ by a day. If you'd
 *   rather use the header date, that's the headerLine's date instead.
 * - Description and reference number (sections 2 and 3) are NOT
 *   reliably distinguishable by pattern alone, so both get joined into
 *   one `description` string. This means descriptions here are noisier
 *   than GTB's (they include Access's internal PP_xxx reference codes
 *   inline). Accepted tradeoff for Sprint 1 — Sprint 2's AI
 *   categorisation should still work fine on text like this.
 * - "Opening Balance" / "Closing Balance" rows are skipped entirely —
 *   they're not real transactions, just running-total markers.
 */

const { normaliseDate } = require('./textHelpers')

// A block-start header line once the wrapped date has been merged back
// together, e.g. "2 01-Jun-2026"
const BLOCK_START_PATTERN = /^\d+\s+(\d{1,2}-[A-Za-z]{3}-\d{4})\s*$/

// The wrapped first half of a block-start header, e.g. "2 01-Jun-"
const WRAPPED_DATE_FIRST_HALF = /^(\d+)\s+(\d{1,2}-[A-Za-z]{3})-\s*$/
// The wrapped second half on the following line, e.g. "2026"
const WRAPPED_DATE_SECOND_HALF = /^(\d{4})\s*$/

// The final data row: "DD-Mon-YYYY  withdrawal  lodgement  balance"
const DATA_ROW_PATTERN = /^(\d{1,2}-[A-Za-z]{3}-\d{4})\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s*$/

function parseAmount(raw) {
  const value = parseFloat(raw.replace(/,/g, ''))
  return Number.isNaN(value) ? null : value
}

/**
 * Rejoins lines where the block-start date got wrapped across two
 * lines, e.g. "2 01-Jun-" + "2026" -> "2 01-Jun-2026".
 */
function mergeWrappedDateHeaders(lines) {
  const merged = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const firstHalf = line.match(WRAPPED_DATE_FIRST_HALF)
    const nextLine = lines[i + 1] || ''
    const secondHalf = firstHalf ? nextLine.match(WRAPPED_DATE_SECOND_HALF) : null

    if (firstHalf && secondHalf) {
      merged.push(`${firstHalf[1]} ${firstHalf[2]}-${secondHalf[1]}`)
      i++ // consume the next line too, it's already merged in
    } else {
      merged.push(line)
    }
  }
  return merged
}

/**
 * Groups lines into one block per transaction, using BLOCK_START_PATTERN
 * lines as delimiters. Any text before the first block start (statement
 * header, account info, column titles) is discarded as preamble.
 */
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

function isBalanceMarkerRow(description) {
  const normalised = description.trim().toLowerCase()
  return normalised.includes('opening balance') || normalised.includes('closing balance')
}

function parseAccessText(rawText) {
  const rawLines = rawText
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)

  const mergedLines = mergeWrappedDateHeaders(rawLines)
  const blocks = splitIntoBlocks(mergedLines)

  const transactions = []
  const unparsedLines = []

  for (const block of blocks) {
    const fullBlockText = block.bodyLines.join(' ')

    // "Opening Balance" / "Closing Balance" rows have a different shape
    // from normal transactions — the label, date, and amounts can all
    // sit on one line ("Opening Balance 01-Jun-2026 0.00 0.00 6,095,821.62"),
    // which won't match DATA_ROW_PATTERN (that pattern requires the line
    // to START with the date). Check for these BEFORE requiring a strict
    // data-row match, or they get misreported as unparsed instead of
    // being correctly skipped as non-transactions.
    if (isBalanceMarkerRow(fullBlockText)) {
      continue
    }

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

    const description = block.bodyLines
      .slice(0, dataRowIndex)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()

    if (!description) {
      unparsedLines.push({
        line: `${block.headerLine} | ${fullBlockText}`,
        reason: 'data row found but no description text in this block',
      })
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

module.exports = { parseAccessText }
