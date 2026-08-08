const { extractTextFromPDF } = require('./pdfTextExtractor')
const { parseCSVBuffer, parseExcelBuffer } = require('./csvExcelParser')
const { parseGTBText } = require('./gtb')
const { parseAccessText } = require('./access')
const { parseZenithText } = require('./zenith')
const { parseFirstBankText } = require('./firstbank')
const { parseProvidusText } = require('./providus')
const { parseMoniepointText } = require('./moniepoint')
const { parseGenericText } = require('./generic')

/**
 * 'auto' = the generic multi-layout parser (four Nigerian layout
 * families, verified against a 36-bank specimen pack). Bank-specific
 * parsers exist where a REAL export's layout was calibrated and it
 * differs from the generic families (Access, Zenith, First Bank,
 * Providus and Moniepoint genuine e-statements are multi-line block
 * formats the generic engine does not attempt).
 */
const SUPPORTED_BANKS = ['auto', 'access', 'zenith', 'gtb', 'firstbank', 'providus', 'moniepoint']

const PDF_TEXT_PARSERS = {
  gtb: parseGTBText,
  access: parseAccessText,
  zenith: parseZenithText,
  firstbank: parseFirstBankText,
  providus: parseProvidusText,
  moniepoint: parseMoniepointText,
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

    // The reverse fallback. 'auto' is what a user picks when they do not know
    // (or do not see) their bank in the list, and the generic engine returns a
    // flat ZERO on a genuine multi-line block export rather than a partial
    // result — a real Moniepoint statement parses 0 rows under 'auto' and 1055
    // under its own parser. Without this, choosing "Other Nigerian banks"
    // silently produced an empty import and looked like a broken upload.
    //
    // Safe to try each in turn: every one of these parsers is anchored on its
    // own bank's layout (its block-start regex has to match before anything is
    // emitted), so a non-matching statement yields nothing rather than
    // garbage. First non-empty result wins, and parserUsed names it so the
    // frontend can still tell the user which layout was assumed.
    if (normalisedBank === 'auto' && result.transactions.length === 0) {
      for (const candidate of SUPPORTED_BANKS) {
        if (candidate === 'auto') continue
        const candidateResult = PDF_TEXT_PARSERS[candidate](rawText)
        if (candidateResult.transactions.length > 0) {
          result = candidateResult
          parserUsed = `auto->${candidate}`
          break
        }
      }
    }

    return { ...result, parserUsed, rawTextPreview: rawText.slice(0, 2000) }
  }

  throw new Error(`Unsupported file type "${fileType}". Expected pdf, csv, or excel.`)
}

module.exports = { parseStatement, SUPPORTED_BANKS }
