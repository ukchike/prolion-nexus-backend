const { PDFParse } = require('pdf-parse')

/**
 * Extracts raw text from a PDF buffer using pdf-parse v2's class-based
 * API. Digital (text-selectable) PDFs only — scanned images need OCR,
 * which is deferred past Sprint 1 per plan.
 */
async function extractTextFromPDF(buffer) {
  const parser = new PDFParse({ data: new Uint8Array(buffer) })
  const result = await parser.getText()
  return result.text
}

module.exports = { extractTextFromPDF }
