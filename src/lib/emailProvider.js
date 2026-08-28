/**
 * Outbound email for NEXUS.
 *
 * Uses Resend's REST API over plain fetch rather than an SDK: the whole
 * surface we need is one POST, and Node 18+ has fetch built in, so a
 * dependency here would buy nothing and add a supply-chain edge to a
 * service that sends customer-facing mail.
 *
 * MISCONFIGURATION IS A DISTINCT, TYPED FAILURE. A missing API key is an
 * operator problem with a specific fix ("set RESEND_API_KEY on the Render
 * service"), not a transient send failure the user should retry. Routes
 * map EmailConfigError to 503 with that message so the person who sees it
 * is told what to do, rather than being handed "failed to send email".
 */

class EmailConfigError extends Error {
  constructor(message) {
    super(message)
    this.name = 'EmailConfigError'
  }
}

class EmailSendError extends Error {
  constructor(message) {
    super(message)
    this.name = 'EmailSendError'
  }
}

function emailConfig() {
  const apiKey = process.env.RESEND_API_KEY
  // A verified sender on the sending domain. Resend rejects anything else,
  // and getting this wrong is the most common first-run failure.
  const from = process.env.INVOICE_FROM_EMAIL
  if (!apiKey || !from) {
    throw new EmailConfigError(
      'Email sending is not configured on the server. Set RESEND_API_KEY and INVOICE_FROM_EMAIL '
      + '(a verified sender on your Resend domain) in the backend environment.'
    )
  }
  return { apiKey, from }
}

function isEmailConfigured() {
  return !!(process.env.RESEND_API_KEY && process.env.INVOICE_FROM_EMAIL)
}

/**
 * @param {object} opts
 * @param {string|string[]} opts.to
 * @param {string} opts.subject
 * @param {string} opts.html
 * @param {string} [opts.text]        plain-text alternative
 * @param {string} [opts.replyTo]     so replies reach the business, not the sending domain
 * @param {{filename:string, content:string}[]} [opts.attachments] content = base64, no data: prefix
 */
async function sendEmail({ to, subject, html, text, replyTo, attachments }) {
  const { apiKey, from } = emailConfig()

  const payload = {
    from,
    to: Array.isArray(to) ? to : [to],
    subject,
    html,
  }
  if (text) payload.text = text
  if (replyTo) payload.reply_to = replyTo
  if (attachments?.length) payload.attachments = attachments

  let response
  try {
    response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })
  } catch (err) {
    // Network-level failure reaching Resend — distinct from Resend itself
    // rejecting the message, and worth retrying.
    throw new EmailSendError(`Could not reach the email service: ${err.message}`)
  }

  if (!response.ok) {
    let detail = ''
    try {
      const body = await response.json()
      detail = body?.message || body?.error?.message || JSON.stringify(body)
    } catch {
      detail = `HTTP ${response.status}`
    }
    // 4xx here is almost always an unverified sender domain or a malformed
    // recipient — surfaced verbatim because the operator needs the specifics.
    throw new EmailSendError(`The email service rejected the message: ${detail}`)
  }

  const result = await response.json().catch(() => ({}))
  return { id: result?.id || null }
}

module.exports = { sendEmail, isEmailConfigured, EmailConfigError, EmailSendError }
