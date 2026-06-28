/**
 * Zenith Bank statement parser.
 *
 * CALIBRATED against a real Zenith statement (RAL Paints Ltd, May/June
 * 2026 — supplied during Sprint 1 testing). Zenith's layout is different
 * again from both GTB's assumption and Access's actual structure:
 *
 *   <CreateDate> <EffectiveDate> <description...>
 *   <more description, wraps freely>
 *   ...possibly inline on the SAME line as the amounts, e.g.:
 *   "<CreateDate> <EffectiveDate> OUTFLOW TO NRS NGN 3,049,424.90 NGN 4,091,915.10"
 *
 * Unlike Access, Zenith does NOT reliably put the amounts on their own
 * dedicated last line — sometimes they're inline with the description,
 * sometimes on a trailing wrapped line. So instead of locating "the data
 * row" the way access.js does, this parser joins the ENTIRE block into
 * one string first, then pulls every "NGN <amount>" occurrence out of
 * it regardless of which original line it was on.
 *
 * Also unlike GTB/Access, Zenith's extracted text does NOT show debit
 * and credit in separate columns per transaction — most lines show only
 * ONE movement amount plus the balance, with no DR/CR marker. Direction
 * (debit vs credit) is determined by comparing the new balance against
 * the running balance carried from the previous transaction (started
 * from the account's Opening Balance, read from the statement header).
 * This is more reliable here than keyword guessing, since the statement
 * gives us full balance continuity to check against.
 *
 * One PDF-extraction artifact worth knowing about: some blank amount
 * cells render as a bare "NGN" with no number after it (e.g. the SMS
 * CHARGE line: "NGN NGN 24.00 NGN 741,134.37"). The amount regex below
 * only matches "NGN" when followed by an actual number, so bare "NGN"
 * tokens are automatically ignored — no special-casing needed.
 */

const { normaliseDate } = require('./textHelpers')

// Block start: two dates at the beginning of a line, e.g.
// "04/05/2026 04/05/2026 NIP/ABN/PP ACCT/PP NIP 1091364814"
const BLOCK_START_PATTERN = /^(\d{1,2}\/\d{1,2}\/\d{2,4})\s+(\d{1,2}\/\d{1,2}\/\d{2,4})\s+(.*)$/

// Every "NGN <amount>" occurrence — bare "NGN" with no following number
// will simply not match this and is silently skipped, which is exactly
// what we want for the blank-cell artifact described above.
const NGN_AMOUNT_PATTERN = /NGN\s*([\d,]+\.\d{2})/g

// Used to find the account's Opening Balance in the statement header,
// e.g. "RAL PAINTS LTD 1015546149 01/05/2026 NGN 5,422,123.03"
const OPENING_BALANCE_LINE_PATTERN = /\b\d{6,}\b\s+\d{1,2}\/\d{1,2}\/\d{2,4}\s+NGN\s*([\d,]+\.\d{2})/

// Lines that mark the end of the transaction table — once hit, the
// current block is closed and no new block starts until the next real
// date-led line (if any, e.g. inside an "UNCLEARED ITEMS" section).
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

/**
 * Groups lines into one block per transaction. A block starts at a
 * BLOCK_START_PATTERN line and continues until the next block start, a
 * STOP_MARKER line, or end of text. Text before the first block start,
 * and any STOP_MARKER lines themselves, are discarded.
 */
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
  const rawLines = rawText
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)

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
      // Both columns present on this line — no direction guessing needed.
      const [debitAmt, creditAmt] = movementAmounts
      debit = debitAmt > 0 ? debitAmt : null
      credit = creditAmt > 0 ? creditAmt : null
    } else if (movementAmounts.length === 1) {
      const amount = movementAmounts[0]
      if (runningBalance === null) {
        unparsedLines.push({
          line: fullText,
          reason: 'cannot determine debit vs credit direction — no opening balance found to compare against',
        })
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

    const description = rest
      .replace(/NGN\s*[\d,]*\.?\d*/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()

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
