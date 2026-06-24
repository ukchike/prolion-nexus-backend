const express = require('express')
const multer = require('multer')
const { parseStatement } = require('../parsers')

const router = express.Router()

// Files are held in memory only — this service never writes uploaded
// files to disk and never touches Supabase. It is a pure parsing
// function: file in, structured transactions out.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB cap
})

function detectFileType(file) {
  const name = (file.originalname || '').toLowerCase()
  if (file.mimetype === 'application/pdf' || name.endsWith('.pdf')) return 'pdf'
  if (name.endsWith('.csv') || file.mimetype === 'text/csv') return 'csv'
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) return 'excel'
  return null
}

router.post('/parse-statement', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded. Send it under the "file" field.' })
    }

    const fileType = detectFileType(req.file)
    if (!fileType) {
      return res.status(400).json({
        error: `Could not determine file type for "${req.file.originalname}". Expected .pdf, .csv, .xlsx, or .xls.`,
      })
    }

    const bankCode = req.body.bankCode // required for PDFs, ignored for csv/excel

    if (fileType === 'pdf' && !bankCode) {
      return res.status(400).json({
        error: 'bankCode is required for PDF uploads (e.g. "gtb", "access", "zenith").',
      })
    }

    const result = await parseStatement({ buffer: req.file.buffer, fileType, bankCode })

    return res.json({
      fileName: req.file.originalname,
      fileType,
      bankCode: bankCode || null,
      transactionCount: result.transactions.length,
      unparsedCount: result.unparsedLines.length,
      transactions: result.transactions,
      unparsedLines: result.unparsedLines,
      rawTextPreview: result.rawTextPreview,
    })
  } catch (err) {
    console.error('Parse error:', err)
    return res.status(500).json({ error: err.message || 'Failed to parse statement.' })
  }
})

module.exports = router
