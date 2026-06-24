const { extractTextFromPDF } = require('./pdfTextExtractor')
const { parseCSVBuffer, parseExcelBuffer } = require('./csvExcelParser')
const { parseGTBText } = require('./gtb')
const { parseAccessText } = require('./access')
const { parseZenithText } = require('./zenith')

const SUPPORTED_BANKS = ['gtb', 'access', 'zenith']

const PDF_TEXT_PARSERS = {
  gtb: parseGTBText,
  access: parseAccessText,
  zenith: parseZenithText,
}

/**
 * Main entry point. Given a file buffer, its mimetype/extension, and the
 * bank the user selected, returns { transactions, unparsedLines, rawTextPreview }.
 *
 * rawTextPreview is included so the frontend can show "what we actually
 * read from your file" when something looks wrong — this is the single
 * most useful debugging aid while calibrating against real statements.
 */
async function parseStatement({ buffer, fileType, bankCode }) {
  const normalisedBank = (bankCode || '').toLowerCase()

  if (fileType === 'csv') {
    const result = parseCSVBuffer(buffer)
    return { ...result, rawTextPreview: buffer.toString('utf-8').slice(0, 2000) }
  }

  if (fileType === 'excel') {
    const result = await parseExcelBuffer(buffer)
    return { ...result, rawTextPreview: null }
  }

  if (fileType === 'pdf') {
    const rawText = await extractTextFromPDF(buffer)

    if (!SUPPORTED_BANKS.includes(normalisedBank)) {
      throw new Error(
        `Unsupported bank "${bankCode}". Supported in Sprint 1: ${SUPPORTED_BANKS.join(', ')}.`
      )
    }

    const parserFn = PDF_TEXT_PARSERS[normalisedBank]
    const result = parserFn(rawText)
    return { ...result, rawTextPreview: rawText.slice(0, 2000) }
  }

  throw new Error(`Unsupported file type "${fileType}". Expected pdf, csv, or excel.`)
}

module.exports = { parseStatement, SUPPORTED_BANKS }
