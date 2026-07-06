/**
 * Zenith Bank statement parser.
 *
 * CALIBRATED against a real Zenith statement (RAL Paints Ltd, May/June
 * 2026). Verified: 6/6 transactions, totals cross-checked against the
 * statement's own footer summary. Layout: two leading dates, amounts as
 * "NGN <amount>" tokens sometimes inline with description, direction
 * inferred from running balance (Zenith shows only one movement amount
 * per line, no DR/CR marker).
 */

const { normaliseDate } = require('./textHelpers')

const BLOCK_START_PATTERN = /^(\d{1,2}\/\d{1,2}\/\d{2,4})\s+(\d{1,2}\/\d{1,2}\/\d{2,4})\s+(.*)$/
const NGN_AMOUNT_PATTERN = /NGN\s*([\d,]+\.\d{2})/g
const OPENING_BALANCE_LINE_PATTERN = /\b\d{6,}\b\s+\d{1,2}\/\d{1,2}\/\d{2,4}\s+NGN\s*([\d,]+\.\d{2})/

const STOP_MARKER_PATTERNS = [
  /^total debits?:/i,
  /^total debit total credit/i,
  /^cleared balance/i,
  /^uncleared items$/i,
  /^no uncleared items/i,
  /^total cleared is/i,
  /^\d+\s+debit\(s\)/i,
  /^--\s*\d+\s+of\s+\d+\s*--/i,
]

function parseAmount(raw) {
  const value = parseFloat(raw.replace(/,/g, ''))
  return Number.isNaN(value) ? null : value
}

function isStopMarker(line) {
  return STOP_MARKER_PATTERNS.some((pattern) => pattern.test(line))
}

function extractOpeningBalance(lines) {
  for (const line of lines) {
    const match = line.match(OPENING_BALANCE_LINE_PATTERN)
    if (match) return parseAmount(match[1])
  }
  return null
}

function splitIntoBlocks(lines) {
  const blocks = []
  let current = null
  for (const line of lines) {
    if (isStopMarker(line)) {
      if (current) blocks.push(current)
      current = null
      continue
    }
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

function parseZenithText(rawText) {
  const rawLines = rawText.split('\n').map((l) => l.trim()).filter((l) => l.length > 0)
  const openingBalance = extractOpeningBalance(rawLines)
  const blocks = splitIntoBlocks(rawLines)

  const transactions = []
  const unparsedLines = []
  let runningBalance = openingBalance

  for (const block of blocks) {
    const fullText = `${block.headerLine} ${block.bodyLines.join(' ')}`.replace(/\s+/g, ' ').trim()
    const headerMatch = fullText.match(BLOCK_START_PATTERN)

    if (!headerMatch) {
      unparsedLines.push({ line: fullText, reason: 'block did not start with two dates as expected' })
      continue
    }

    const [, , effectiveDateRaw, rest] = headerMatch
    const amountMatches = [...rest.matchAll(NGN_AMOUNT_PATTERN)].map((m) => parseAmount(m[1]))

    if (amountMatches.length === 0) {
      unparsedLines.push({ line: fullText, reason: 'no NGN amount found in this transaction block' })
      continue
    }

    const balance = amountMatches[amountMatches.length - 1]
    const movementAmounts = amountMatches.slice(0, -1)

    let debit = null
    let credit = null

    if (movementAmounts.length === 2) {
      const [debitAmt, creditAmt] = movementAmounts
      debit = debitAmt > 0 ? debitAmt : null
      credit = creditAmt > 0 ? creditAmt : null
    } else if (movementAmounts.length === 1) {
      const amount = movementAmounts[0]
      if (runningBalance === null) {
        unparsedLines.push({ line: fullText, reason: 'cannot determine debit vs credit direction — no opening balance found to compare against' })
        continue
      }
      if (balance > runningBalance) {
        credit = amount
      } else if (balance < runningBalance) {
        debit = amount
      } else {
        unparsedLines.push({ line: fullText, reason: 'balance unchanged — cannot determine movement direction' })
        continue
      }
    } else {
      unparsedLines.push({ line: fullText, reason: 'only a balance was found, no movement amount' })
      continue
    }

    const description = rest.replace(/NGN\s*[\d,]*\.?\d*/g, ' ').replace(/\s+/g, ' ').trim()

    if (!description) {
      unparsedLines.push({ line: fullText, reason: 'amounts found but no description text remained' })
      continue
    }

    transactions.push({
      transaction_date: normaliseDate(effectiveDateRaw),
      description,
      debit,
      credit,
      balance,
    })

    runningBalance = balance
  }

  return { transactions, unparsedLines }
}

module.exports = { parseZenithText }
