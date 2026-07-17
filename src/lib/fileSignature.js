/**
 * Verifies a file's actual byte content matches its claimed type before
 * handing the buffer to a parser library. `detectFileType()` in
 * routes/statements.js only looks at the client-supplied filename
 * extension and Content-Type header — both are trivially spoofable (a
 * malicious upload can be named "statement.pdf" and sent with
 * `Content-Type: application/pdf` regardless of what bytes it actually
 * contains). This isn't a substitute for real antivirus/malware
 * scanning — it's the cheap, dependency-free check that closes the
 * "type confusion" class of upload vulnerability, where a parser
 * library ends up processing bytes it was never designed to handle.
 */

const PDF_MAGIC = Buffer.from('%PDF-')
// .xlsx (and modern .docx/.pptx) are ZIP containers under the hood —
// this only confirms "valid ZIP", not "valid xlsx specifically", but a
// non-ZIP file claiming to be .xlsx is definitely wrong.
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04])
// Legacy .xls (OLE Compound File Binary Format) — some Nigerian bank
// exports still use the old binary Excel format.
const OLE_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])

function looksLikePdf(buffer) {
  return buffer.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC)
}

function looksLikeExcel(buffer) {
  const head = buffer.subarray(0, 8)
  return head.subarray(0, ZIP_MAGIC.length).equals(ZIP_MAGIC) || head.equals(OLE_MAGIC)
}

// CSV has no magic number — the best available check is that it's
// text, not binary. A real CSV/text export won't contain null bytes,
// and should decode as valid UTF-8 (or plain ASCII, a UTF-8 subset).
function looksLikeText(buffer) {
  const sample = buffer.subarray(0, Math.min(buffer.length, 8192))
  if (sample.includes(0x00)) return false
  try {
    // fatal: true makes TextDecoder throw on invalid UTF-8 instead of
    // silently substituting replacement characters, which is what we
    // actually want to detect here.
    new TextDecoder('utf-8', { fatal: true }).decode(sample)
    return true
  } catch {
    return false
  }
}

/**
 * @param {Buffer} buffer
 * @param {'pdf'|'csv'|'excel'} fileType - the type detectFileType() claimed
 * @returns {boolean}
 */
function matchesClaimedType(buffer, fileType) {
  if (!buffer || buffer.length === 0) return false
  if (fileType === 'pdf') return looksLikePdf(buffer)
  if (fileType === 'excel') return looksLikeExcel(buffer)
  if (fileType === 'csv') return looksLikeText(buffer)
  return false
}

module.exports = { matchesClaimedType }
