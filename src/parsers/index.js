const { extractTextFromPDF } = require('./pdfTextExtractor')
const { parseCSVBuffer, parseExcelBuffer } = require('./csvExcelParser')
const { parseGTBText } = require('./gtb')
const { parseAccessText } = require('./access')
const { parseZenithText } = require('./zenith')
const { parseGenericText } = require('./generic')

/**
 * 'auto' = the generic multi-layout parser (four Nigerian layout
 * families, verified against a 36-bank specimen pack). Bank-specific
 * parsers exist where a REAL export's layout was calibrated and it
 * differs from the generic families (Access and Zenith genuine
 * e-statements are multi-line block formats the generic engine does
 * not attempt).
 */
const SUPPORTED_BANKS = ['auto', 'access', 'zenith', 'gtb']

const PDF_TEXT_PARSERS = {
  gtb: parseGTBText,
  access: parseAccessText,
  zenith: parseZenithText,
  auto: parseGenericText,
}

async function parseStatement({ buffer, fileType, bankCode }) {
  const normalisedBank = (bankCode || '').toLowerCase()

  if (fileType === 'csv') {
    const result = parseCSVBuffer(buffer)
    return { ...result, parserUsed: 'csv', rawTextPreview: buffer.toString('utf-8').slice(0, 2000) }
  }

  if (fileType === 'excel') {
    const result = await parseExcelBuffer(buffer)
    return { ...result, parserUsed: 'excel', rawTextPreview: null }
  }

  if (fileType === 'pdf') {
    const rawText = await extractTextFromPDF(buffer)

    if (!SUPPORTED_BANKS.includes(normalisedBank)) {
      throw new Error(`Unsupported bank "${bankCode}". Options: ${SUPPORTED_BANKS.join(', ')} ('auto' covers most Nigerian internet/mobile banking layouts).`)
    }

    const parserFn = PDF_TEXT_PARSERS[normalisedBank]
    let result = parserFn(rawText)
    let parserUsed = normalisedBank

    // Fallback: a bank-specific parser finding NOTHING usually means
    // the bank has changed/varies its export layout — rather than
    // returning a dead zero, try the generic multi-layout engine before
    // giving up. The response records which parser actually produced
    // the result so the frontend can tell the user to double-check.
    if (normalisedBank !== 'auto' && result.transactions.length === 0) {
      const genericResult = parseGenericText(rawText)
      if (genericResult.transactions.length > 0) {
        result = genericResult
        parserUsed = `${normalisedBank}->auto-fallback`
      }
    }

    return { ...result, parserUsed, rawTextPreview: rawText.slice(0, 2000) }
  }

  throw new Error(`Unsupported file type "${fileType}". Expected pdf, csv, or excel.`)
}

module.exports = { parseStatement, SUPPORTED_BANKS }
