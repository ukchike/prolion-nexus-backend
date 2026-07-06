/**
 * Parses CSV and Excel (.xlsx) exports into the same transaction shape
 * the PDF parsers produce. Column headers matched flexibly since banks
 * label columns differently.
 */

const Papa = require('papaparse')
const ExcelJS = require('exceljs')
const { normaliseDate } = require('./textHelpers')

const HEADER_ALIASES = {
  date: ['date', 'transaction date', 'trans date', 'value date', 'txn date'],
  description: ['description', 'narration', 'particulars', 'details', 'remarks'],
  debit: ['debit', 'withdrawal', 'dr'],
  credit: ['credit', 'deposit', 'cr'],
  balance: ['balance', 'running balance', 'closing balance'],
}

function matchHeader(headerRow) {
  const normalised = headerRow.map((h) => (h || '').toString().trim().toLowerCase())
  const columnMap = {}
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    const colIndex = normalised.findIndex((h) => aliases.some((alias) => h.includes(alias)))
    if (colIndex !== -1) columnMap[field] = colIndex
  }
  return columnMap
}

function parseAmount(value) {
  if (value === null || value === undefined || value === '') return null
  const cleaned = value.toString().replace(/,/g, '').trim()
  const num = parseFloat(cleaned)
  return Number.isNaN(num) ? null : num
}

function rowsToTransactions(rows) {
  if (rows.length === 0) {
    return { transactions: [], unparsedLines: [{ line: '', reason: 'file had no rows' }] }
  }

  const columnMap = matchHeader(rows[0])
  const dataRows = rows.slice(1)
  const transactions = []
  const unparsedLines = []

  if (columnMap.date === undefined || columnMap.description === undefined) {
    return {
      transactions: [],
      unparsedLines: [{
        line: rows[0].join(' | '),
        reason: 'could not identify date/description columns from header row — check HEADER_ALIASES in csvExcelParser.js',
      }],
    }
  }

  for (const row of dataRows) {
    if (!row || row.every((cell) => cell === null || cell === undefined || cell === '')) continue

    const rawDate = row[columnMap.date]
    const transactionDate =
      rawDate instanceof Date ? rawDate.toISOString().slice(0, 10) : normaliseDate((rawDate || '').toString())
    const description = (row[columnMap.description] || '').toString().trim()
    const debit = columnMap.debit !== undefined ? parseAmount(row[columnMap.debit]) : null
    const credit = columnMap.credit !== undefined ? parseAmount(row[columnMap.credit]) : null
    const balance = columnMap.balance !== undefined ? parseAmount(row[columnMap.balance]) : null

    if (!transactionDate || !description) {
      unparsedLines.push({ line: row.join(' | '), reason: 'missing date or description after parsing' })
      continue
    }

    transactions.push({ transaction_date: transactionDate, description, debit, credit, balance })
  }

  return { transactions, unparsedLines }
}

function parseCSVBuffer(buffer) {
  const text = buffer.toString('utf-8')
  const result = Papa.parse(text, { skipEmptyLines: true })
  return rowsToTransactions(result.data)
}

async function parseExcelBuffer(buffer) {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer)
  const worksheet = workbook.worksheets[0]
  const rows = []
  worksheet.eachRow({ includeEmpty: false }, (row) => {
    const values = row.values.slice(1)
    rows.push(values.map((v) => (v && v.result !== undefined ? v.result : v)))
  })
  return rowsToTransactions(rows)
}

module.exports = { parseCSVBuffer, parseExcelBuffer }
