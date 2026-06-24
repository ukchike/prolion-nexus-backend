/**
 * Shared helpers for turning a raw line of bank-statement text into
 * structured pieces: a date, a list of money amounts, and the
 * description text left over once those are removed.
 *
 * IMPORTANT — calibration notice:
 * These patterns are built from common Nigerian bank e-statement layouts
 * (date, narration, debit, credit, balance columns). They have NOT been
 * tested against a real GTB / Access / Zenith export. Run a real
 * statement through this parser (see README "Calibrating against a real
 * statement") and adjust DATE_PATTERN / AMOUNT_PATTERN if lines aren't
 * matching.
 */

// Matches dates like "01-Jan-2025", "01/01/2025", "01-Jan-25", "1/1/25"
const DATE_PATTERN =
  /(\d{1,2}[-/](?:[A-Za-z]{3}|\d{1,2})[-/]\d{2,4})/

// Matches money amounts like "150,000.00", "5,000.00", "150000.00"
// Requires a decimal point with exactly 2 digits to avoid matching
// account numbers or reference numbers that happen to contain digits.
const AMOUNT_PATTERN = /-?[\d,]+\.\d{2}/g

// Matches a trailing DR/CR/Dr/Cr indicator, common in some bank exports
const DRCR_PATTERN = /\b(DR|CR)\b/i

const MONTH_MAP = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
}

/**
 * Normalises a date string like "01-Jan-2025" or "01/01/2025" into
 * ISO format "2025-01-01". Returns null if it cannot confidently parse.
 */
function normaliseDate(rawDate) {
  if (!rawDate) return null
  const cleaned = rawDate.trim()

  // Format: DD-MMM-YYYY or DD-MMM-YY (e.g. 01-Jan-2025)
  const monthNameMatch = cleaned.match(/^(\d{1,2})[-/]([A-Za-z]{3})[-/](\d{2,4})$/)
  if (monthNameMatch) {
    const [, day, monthAbbrev, yearRaw] = monthNameMatch
    const month = MONTH_MAP[monthAbbrev.toLowerCase()]
    if (!month) return null
    const year = yearRaw.length === 2 ? `20${yearRaw}` : yearRaw
    return `${year}-${month}-${day.padStart(2, '0')}`
  }

  // Format: DD/MM/YYYY or DD-MM-YYYY
  const numericMatch = cleaned.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/)
  if (numericMatch) {
    const [, day, month, yearRaw] = numericMatch
    const year = yearRaw.length === 2 ? `20${yearRaw}` : yearRaw
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
  }

  return null
}

/**
 * Extracts every date occurrence from a line (some statements show both
 * a transaction date and a value date at the start of the line).
 * Returns an array of { raw, normalised, index } in order of appearance.
 */
function extractDates(line) {
  const matches = []
  const regex = new RegExp(DATE_PATTERN, 'g')
  let match
  while ((match = regex.exec(line)) !== null) {
    matches.push({
      raw: match[0],
      normalised: normaliseDate(match[0]),
      index: match.index,
    })
  }
  return matches
}

/**
 * Extracts every money amount from a line, in order of appearance,
 * along with its numeric value (commas stripped, parsed as float).
 */
function extractAmounts(line) {
  const matches = []
  const regex = new RegExp(AMOUNT_PATTERN)
  let remaining = line
  let offset = 0
  let match
  while ((match = regex.exec(remaining)) !== null) {
    const raw = match[0]
    const value = parseFloat(raw.replace(/,/g, ''))
    matches.push({ raw, value, index: offset + match.index })
    offset += match.index + raw.length
    remaining = remaining.slice(match.index + raw.length)
    regex.lastIndex = 0
  }
  return matches
}

/**
 * Strips known structural tokens (dates, amounts, DR/CR markers) out of
 * a line and returns what's left — used as the transaction description.
 */
function extractDescription(line, dates, amounts) {
  let result = line

  // Both `dates` and `amounts` already carry correct {index, raw/length}
  // positions relative to the original line — reuse them directly rather
  // than re-scanning the string a second time.
  const spans = [
    ...dates.map((d) => ({ start: d.index, end: d.index + d.raw.length })),
    ...amounts.map((a) => ({ start: a.index, end: a.index + a.raw.length })),
  ]

  // Remove spans right-to-left so earlier indices stay valid as we splice
  spans.sort((a, b) => b.start - a.start)
  for (const span of spans) {
    result = result.slice(0, span.start) + ' ' + result.slice(span.end)
  }

  result = result.replace(DRCR_PATTERN, ' ')
  result = result.replace(/\s+/g, ' ').trim()
  return result
}

/**
 * Determines whether a line "looks like" a transaction line — i.e. it
 * starts with something that parses as a date. Used to separate real
 * transaction rows from headers, footers, and page-break text.
 */
function looksLikeTransactionLine(line) {
  const trimmed = line.trim()
  if (!trimmed) return false
  const dateMatch = trimmed.match(DATE_PATTERN)
  // Require the date to appear at (or very near) the start of the line —
  // this avoids matching a date that's mentioned mid-sentence in a footer.
  return !!dateMatch && dateMatch.index <= 3
}

module.exports = {
  DATE_PATTERN,
  AMOUNT_PATTERN,
  DRCR_PATTERN,
  normaliseDate,
  extractDates,
  extractAmounts,
  extractDescription,
  looksLikeTransactionLine,
}
