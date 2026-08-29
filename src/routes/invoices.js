/**
 * Sending an invoice to the customer it bills.
 *
 * WHY THE PDF ARRIVES FROM THE CLIENT. PRIXUM already renders a branded,
 * correct invoice PDF in the browser (components/sales/documentPdf.js) —
 * logo, bank details, WHT/VAT lines, signatory block. Re-rendering it here
 * would be a SECOND implementation of the same document, and the two
 * drifting apart is exactly the class of bug this codebase avoids
 * elsewhere by keeping one source of truth per figure. So the client sends
 * the bytes it already produced and this route is responsible only for
 * delivery. The trade-off is that we trust the caller for the attachment's
 * contents — acceptable because the caller is the authenticated owner of
 * that invoice, and the only party the mail is sent to is the customer
 * address stored against it (or one the sender typed themselves).
 *
 * Marking the invoice `sent` happens HERE rather than in a follow-up call
 * from the client: the mail has already left, and a second round trip that
 * could fail would leave the customer holding an invoice the app still
 * shows as a draft.
 */
const express = require('express')
const { requireAuth } = require('../middleware/requireAuth')
const { getAdminClient } = require('../lib/supabaseAdmin')
const { sendEmail, EmailConfigError, EmailSendError } = require('../lib/emailProvider')

const router = express.Router()

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
// Comfortably above a logo-bearing invoice (~15-40KB) while staying well
// inside express.json's 5mb body cap once base64 overhead is counted.
const MAX_PDF_BASE64_CHARS = 3_000_000

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

/** The sender's typed message, as HTML paragraphs. Escaped first — this is
 *  user input landing in an email body, and the business's own customer is
 *  the one who renders it. */
function messageToHtml(message) {
  return String(message || '')
    .split(/\n{2,}/)
    .map((para) => `<p style="margin:0 0 14px">${escapeHtml(para).replace(/\n/g, '<br>')}</p>`)
    .join('')
}

function buildHtml({ message, businessName, invoiceNumber }) {
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f6f8f7">
  <div style="max-width:560px;margin:0 auto;padding:28px 24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#22383f">
    ${messageToHtml(message)}
    <p style="margin:22px 0 0;padding-top:16px;border-top:1px solid #dde4e3;font-size:12px;color:#5e7176">
      ${escapeHtml(invoiceNumber)} is attached as a PDF.<br>
      Sent by ${escapeHtml(businessName)} via PRIXUM.
    </p>
  </div></body></html>`
}

async function getOwnMembership(supabaseAdmin, userId) {
  const { data, error } = await supabaseAdmin
    .from('company_members')
    .select('company_id, role')
    .eq('user_id', userId)
    .eq('status', 'active')
    .maybeSingle()
  if (error) throw error
  return data
}

router.post('/invoices/:invoiceId/send', requireAuth, async (req, res) => {
  const { invoiceId } = req.params
  const { to, subject, message, pdfBase64, fileName } = req.body || {}

  if (!to || !EMAIL_RE.test(String(to).trim())) {
    return res.status(400).json({ error: 'Enter a valid recipient email address.' })
  }
  if (!subject || !String(subject).trim()) {
    return res.status(400).json({ error: 'Enter a subject for the email.' })
  }
  if (!pdfBase64 || typeof pdfBase64 !== 'string') {
    return res.status(400).json({ error: 'The invoice PDF was missing from the request.' })
  }
  if (pdfBase64.length > MAX_PDF_BASE64_CHARS) {
    return res.status(413).json({ error: 'That invoice PDF is too large to email.' })
  }

  try {
    const supabaseAdmin = getAdminClient()
    const membership = await getOwnMembership(supabaseAdmin, req.user.id)
    if (!membership) {
      return res.status(404).json({ error: 'No active company membership found for this account.' })
    }

    const { data: invoice, error: invoiceError } = await supabaseAdmin
      .from('invoices')
      .select('id, company_id, invoice_number, status')
      .eq('id', invoiceId)
      .maybeSingle()
    if (invoiceError) throw invoiceError
    // Same 404 for "no such invoice" and "not yours" — distinguishing them
    // would let a caller probe which invoice ids exist on other companies.
    if (!invoice || invoice.company_id !== membership.company_id) {
      return res.status(404).json({ error: 'Invoice not found.' })
    }

    const { data: company } = await supabaseAdmin
      .from('company_profiles')
      .select('legal_name')
      .eq('id', membership.company_id)
      .maybeSingle()
    const businessName = company?.legal_name || 'Your supplier'

    await sendEmail({
      to: String(to).trim(),
      subject: String(subject).trim(),
      html: buildHtml({ message, businessName, invoiceNumber: invoice.invoice_number }),
      text: String(message || ''),
      // Replies go to the person who pressed Send, not to the sending domain.
      replyTo: req.user.email || undefined,
      attachments: [{
        filename: fileName || `${invoice.invoice_number}.pdf`,
        content: pdfBase64,
      }],
    })

    // Only a draft advances. An approved or part-paid invoice has already
    // moved past 'sent', and resending a copy must not walk its status
    // backwards — which would also silently un-recognise accrual revenue.
    let status = invoice.status
    if (invoice.status === 'draft') {
      const { error: updateError } = await supabaseAdmin
        .from('invoices').update({ status: 'sent' }).eq('id', invoice.id)
      if (!updateError) status = 'sent'
    }

    return res.json({ sent: true, status, invoiceNumber: invoice.invoice_number })
  } catch (err) {
    if (err instanceof EmailConfigError) {
      console.error(`[invoices/send] not configured: ${err.message}`)
      return res.status(503).json({ error: err.message })
    }
    if (err instanceof EmailSendError) {
      console.error(`[invoices/send] send failed: ${err.message}`)
      return res.status(502).json({ error: err.message })
    }
    console.error(`[invoices/send] unexpected: ${err.name}: ${err.message}`)
    return res.status(500).json({ error: 'Could not send the invoice. Please try again.' })
  }
})

module.exports = router
