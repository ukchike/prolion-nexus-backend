const express = require('express')
const multer = require('multer')
const { parseStatement, SUPPORTED_BANKS } = require('../parsers')

// Parsers whose layout assumptions haven't been calibrated against a real
// export from that bank (see the CALIBRATION NOTICE in parsers/gtb.js) —
// their results are flagged `unverified: true` in the response so the
// frontend can warn the user to double-check the figures rather than
// trusting them the same as a calibrated parser's output.
const UNVERIFIED_PARSERS = new Set(['gtb'])
const { requireAuth } = require('../middleware/requireAuth')
const { parseLimiter } = require('../middleware/rateLimiters')
const { matchesClaimedType } = require('../lib/fileSignature')

const router = express.Router()

// Files held in memory only — this service never writes uploads to disk
// and never touches Supabase. Pure function: file in, transactions out.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
})

function detectFileType(file) {
  const name = (file.originalname || '').toLowerCase()
  if (file.mimetype === 'application/pdf' || name.endsWith('.pdf')) return 'pdf'
  if (name.endsWith('.csv') || file.mimetype === 'text/csv') return 'csv'
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) return 'excel'
  return null
}

router.post('/parse-statement', requireAuth, parseLimiter, upload.single('file'), async (req, res) => {
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

    // The filename/Content-Type above are both client-supplied and
    // trivially spoofable — this confirms the actual bytes match before
    // handing them to a parser library. See lib/fileSignature.js.
    if (!matchesClaimedType(req.file.buffer, fileType)) {
      return res.status(400).json({
        error: `"${req.file.originalname}" doesn't look like a valid ${fileType.toUpperCase()} file — its content doesn't match its extension. Re-export the statement and try again.`,
      })
    }

    const bankCode = req.body.bankCode

    if (fileType === 'pdf' && !bankCode) {
      return res.status(400).json({
        error: 'bankCode is required for PDF uploads (e.g. "gtb", "access", "zenith").',
      })
    }

    // Client input validation belongs at the route, not inside the parser
    // dispatcher — an invalid bankCode is the caller's mistake (400), not
    // a server failure (500).
    if (fileType === 'pdf' && !SUPPORTED_BANKS.includes(bankCode.toLowerCase())) {
      return res.status(400).json({
        error: `Unsupported bank "${bankCode}". Options: ${SUPPORTED_BANKS.join(', ')} ('auto' covers most Nigerian internet/mobile banking layouts).`,
      })
    }

    const result = await parseStatement({ buffer: req.file.buffer, fileType, bankCode })

    return res.json({
      fileName: req.file.originalname,
      fileType,
      bankCode: bankCode || null,
      unverified: UNVERIFIED_PARSERS.has(result.parserUsed),
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
