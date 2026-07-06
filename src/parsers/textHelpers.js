/**
 * Shared helpers for turning a raw line of bank-statement text into
 * structured pieces: a date, a list of money amounts, and the
 * description text left over once those are removed.
 */

const DATE_PATTERN = /(\d{1,2}[-/](?:[A-Za-z]{3}|\d{1,2})[-/]\d{2,4})/
const AMOUNT_PATTERN = /-?[\d,]+\.\d{2}/g
const DRCR_PATTERN = /\b(DR|CR)\b/i

const MONTH_MAP = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
}

function normaliseDate(rawDate) {
  if (!rawDate) return null
  const cleaned = rawDate.trim()

  const monthNameMatch = cleaned.match(/^(\d{1,2})[-/]([A-Za-z]{3})[-/](\d{2,4})$/)
  if (monthNameMatch) {
    const [, day, monthAbbrev, yearRaw] = monthNameMatch
    const month = MONTH_MAP[monthAbbrev.toLowerCase()]
    if (!month) return null
    const year = yearRaw.length === 2 ? `20${yearRaw}` : yearRaw
    return `${year}-${month}-${day.padStart(2, '0')}`
  }

  const numericMatch = cleaned.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/)
  if (numericMatch) {
    const [, day, month, yearRaw] = numericMatch
    const year = yearRaw.length === 2 ? `20${yearRaw}` : yearRaw
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
  }

  return null
}

function extractDates(line) {
  const matches = []
  const regex = new RegExp(DATE_PATTERN, 'g')
  let match
  while ((match = regex.exec(line)) !== null) {
    matches.push({ raw: match[0], normalised: normaliseDate(match[0]), index: match.index })
  }
  return matches
}

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

function extractDescription(line, dates, amounts) {
  let result = line
  const spans = [
    ...dates.map((d) => ({ start: d.index, end: d.index + d.raw.length })),
    ...amounts.map((a) => ({ start: a.index, end: a.index + a.raw.length })),
  ]
  spans.sort((a, b) => b.start - a.start)
  for (const span of spans) {
    result = result.slice(0, span.start) + ' ' + result.slice(span.end)
  }
  result = result.replace(DRCR_PATTERN, ' ')
  result = result.replace(/\s+/g, ' ').trim()
  return result
}

function looksLikeTransactionLine(line) {
  const trimmed = line.trim()
  if (!trimmed) return false
  const dateMatch = trimmed.match(DATE_PATTERN)
  return !!dateMatch && dateMatch.index <= 3
}

module.exports = {
  DATE_PATTERN, AMOUNT_PATTERN, DRCR_PATTERN,
  normaliseDate, extractDates, extractAmounts, extractDescription, looksLikeTransactionLine,
}
