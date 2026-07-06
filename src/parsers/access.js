/**
 * Access Bank statement parser.
 *
 * CALIBRATED against a real Access Bank statement (RAL Paints Ltd,
 * June 2026). Verified in production: 117 real transactions parsed and
 * saved. Layout — each transaction spans MULTIPLE lines:
 *   1. "<S/NO> <DD-Mon->" + "<YYYY>"  (wrapped date header)
 *   2. description text (1+ lines, wraps freely)
 *   3. reference number (1+ lines)
 *   4. "<DD-Mon-YYYY> <withdrawal> <lodgement> <balance>" (value date row)
 */

const { normaliseDate } = require('./textHelpers')

const BLOCK_START_PATTERN = /^\d+\s+(\d{1,2}-[A-Za-z]{3}-\d{4})\s*$/
const WRAPPED_DATE_FIRST_HALF = /^(\d+)\s+(\d{1,2}-[A-Za-z]{3})-\s*$/
const WRAPPED_DATE_SECOND_HALF = /^(\d{4})\s*$/
const DATA_ROW_PATTERN = /^(\d{1,2}-[A-Za-z]{3}-\d{4})\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s*$/

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

function parseAccessText(rawText) {
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

module.exports = { parseAccessText }
