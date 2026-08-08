/**
 * Moniepoint (business account) statement parser.
 *
 * CALIBRATED against a real Moniepoint "Account Statement" (SD AQUA PROOF
 * LIMITED, account 6163292583, 01/01/2026 – 07/08/2026, 97 pages). Verified:
 * all 1,055 rows parse, and the totals reconcile to the statement's own
 * summary box to the kobo — TOTAL DEBITS 64,546,674.99, TOTAL CREDITS
 * 66,570,451.76, and OPENING 3,525.00 + credits − debits = CLOSING
 * 2,027,301.77 exactly.
 *
 * THREE THINGS ABOUT THIS LAYOUT THAT WILL BREAK A NAIVE PARSER.
 *
 * 1. The timestamp is SPLIT ACROSS TWO LINES. A row begins with a line that
 *    is nothing but `2026-01-16T07:` and the remaining minutes/seconds open
 *    the next line. Worse, the split point varies: usually `MM:SS` continues
 *    it ("59:52 ..."), but in 25 of the 1,055 rows only the minutes carry
 *    over ("26 work ..."). Both forms have to be consumed off the front of
 *    the narration or the description is polluted with digits.
 *
 * 2. DIRECTION COMES FROM THE COLUMNS, NEVER FROM THE REFERENCE. Every
 *    reference ends `_DEBIT_n` or `_CREDIT_n`, which looks like a free
 *    direction flag — and it is a trap. This statement contains 3 REVERSALS
 *    whose reference reads `..._DEBIT_0_RVSL` while the money moves in the
 *    CREDIT column, because a reversal credits back an original debit.
 *    Trusting the suffix books all three backwards, and a reversal is exactly
 *    the row a user would notice. Moniepoint prints explicit Debit and Credit
 *    columns, so direction is read, not inferred — unlike zenith.js and
 *    providus.js, which have only one amount per row and must compare running
 *    balances to work it out.
 *
 * 3. ROWS ARE NOT IN BALANCE ORDER. Postings sharing a timestamp (a transfer
 *    plus its VAT and stamp duty) appear in an arbitrary order within the
 *    group — the final page lists the stamp duty before the transfer it was
 *    charged on, so the Balance column reads 2,027,301.77 then 2,027,353.27
 *    then 2,027,351.77. Any verification that walks the balance chain in file
 *    order therefore has to reorder each same-timestamp group first (see
 *    scripts/calibrate-moniepoint.js, which does this and confirms the chain
 *    is exact); the parser itself preserves file order and does not depend on
 *    the chain at all.
 */

const BLOCK_START_PATTERN = /^(\d{4}-\d{2}-\d{2})T(\d{1,2}):$/
// Debit, Credit and Balance, in that column order, closing the row.
const TRAILING_AMOUNTS_PATTERN = /^(.*?)\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})$/
// The minutes (and usually seconds) the header line was cut off mid-way
// through. Anchored and only ever applied to a block's FIRST body line, where
// the remainder of the timestamp is the one thing guaranteed to be present.
const TIME_REMAINDER_PATTERN = /^(\d{1,2})(?::(\d{2}))?(?=\s|$)/
const REFERENCE_PATTERN = /_(?:DEBIT|CREDIT)_\d+(?:_[A-Z]+)?$/
const PAGE_MARKER_PATTERN = /^--\s*\d+\s+of\s+\d+\s*--$/
const COLUMN_HEADER_PATTERN = /^Date\s+Narration\s+Reference\s+Debit\s+Credit\s+Balance$/i

function parseAmount(raw) {
  const value = parseFloat(String(raw).replace(/,/g, ''))
  return Number.isNaN(value) ? null : value
}

/** The summary box Moniepoint prints above the table. Labels wrap ("Opening"
 *  on one line, "Balance 3,525.00" on the next), which `\s+` absorbs. Used by
 *  the calibration script to check the parse against the bank's own totals. */
function parseSummary(rawText) {
  const grab = (label) => {
    const match = rawText.match(new RegExp(`${label}\\s+([\\d,]+\\.\\d{2})`, 'i'))
    return match ? parseAmount(match[1]) : null
  }
  return {
    openingBalance: grab('Opening\\s+Balance'),
    totalDebits: grab('Total\\s+Debits'),
    totalCredits: grab('Total\\s+Credits'),
    closingBalance: grab('Closing\\s+Balance'),
  }
}

function parseMoniepointText(rawText) {
  const lines = rawText.split('\n').map((l) => l.replace(/\s+$/, ''))
  const transactions = []
  const unparsedLines = []

  let index = 0
  while (index < lines.length) {
    const startMatch = lines[index].trim().match(BLOCK_START_PATTERN)
    if (!startMatch) { index += 1; continue }

    const [, datePart] = startMatch

    // Collect body lines up to and including the one that closes the row with
    // its three amounts. Bounded by the next block start so a row that never
    // terminates (a truncated export) is reported rather than swallowing the
    // rest of the statement.
    const body = []
    let cursor = index + 1
    let closingLine = null
    while (cursor < lines.length) {
      const line = lines[cursor]
      if (BLOCK_START_PATTERN.test(line.trim())) break
      if (TRAILING_AMOUNTS_PATTERN.test(line)) { closingLine = line; break }
      if (line.trim() && !PAGE_MARKER_PATTERN.test(line.trim())) body.push(line.trim())
      cursor += 1
    }

    if (!closingLine) {
      unparsedLines.push({
        line: `${lines[index]} ${body.join(' ')}`.trim(),
        reason: 'row never reached its Debit/Credit/Balance line (often a truncated or cut-off export)',
      })
      index = cursor
      continue
    }

    const [, headRaw, debitRaw, creditRaw, balanceRaw] = closingLine.match(TRAILING_AMOUNTS_PATTERN)
    const segments = [...body, headRaw.trim()].filter(Boolean)

    // Strip the carried-over minutes/seconds off whatever came first.
    if (segments.length > 0) {
      segments[0] = segments[0].replace(TIME_REMAINDER_PATTERN, '').trim()
    }

    let head = segments.join(' ').replace(/\s+/g, ' ').trim()

    // The reference is the last token, and it is machine noise
    // ("TRF|2MPTj01h3|2085697546509484032_DEBIT_0") rather than anything a
    // user wants to read — so it comes out of the description. A reversal is
    // the one case where the reference carries real meaning, so that survives
    // as a readable note instead of being thrown away with it.
    let reference = null
    const tokens = head.split(' ')
    const lastToken = tokens[tokens.length - 1]
    if (tokens.length > 1 && REFERENCE_PATTERN.test(lastToken)) {
      reference = lastToken
      head = tokens.slice(0, -1).join(' ').trim()
      if (/_RVSL$/.test(reference)) head = `${head} (reversal)`.trim()
    }

    const debit = parseAmount(debitRaw)
    const credit = parseAmount(creditRaw)
    const balance = parseAmount(balanceRaw)
    const description = head || reference || 'Moniepoint transaction'

    index = cursor + 1

    // Exactly one column carries the movement. Both populated, or neither,
    // means the row was not read the way this layout promises — surfaced
    // rather than guessed at, since either guess could misstate the books.
    if (debit > 0 && credit > 0) {
      unparsedLines.push({ line: description, reason: 'both Debit and Credit columns are non-zero — cannot determine direction' })
      continue
    }
    if (!(debit > 0) && !(credit > 0)) {
      unparsedLines.push({ line: description, reason: 'both Debit and Credit columns are zero — no movement to record' })
      continue
    }

    transactions.push({
      transaction_date: datePart,
      description,
      debit: debit > 0 ? debit : null,
      credit: credit > 0 ? credit : null,
      balance,
    })
  }

  return { transactions, unparsedLines }
}

module.exports = { parseMoniepointText, parseSummary }
