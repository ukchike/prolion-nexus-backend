/**
 * Paystack — the first PaymentProvider implementation. Every subscription
 * route talks to this module's exports, never to Paystack's HTTP API
 * directly, so a second provider (Flutterwave) is a second file with the
 * same shape, not a rewrite of routes/billing.js.
 *
 * Paystack's secret key never leaves this process: it goes in the
 * Authorization header of server-to-server calls only. The frontend only
 * ever sees the public key (for card capture UI, if that path is ever
 * added) and an authorization_url to redirect to — never the secret key,
 * never a raw webhook payload without this module having verified its
 * signature first.
 */
const crypto = require('crypto')

const BASE_URL = 'https://api.paystack.co'

function getSecretKey() {
  const key = process.env.PAYSTACK_SECRET_KEY
  if (!key) {
    throw new Error('PAYSTACK_SECRET_KEY is not configured on this server. Add it to the Render service’s environment variables (or .env locally).')
  }
  return key
}

async function paystackFetch(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${getSecretKey()}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok || json.status === false) {
    throw new Error(json.message || `Paystack request failed (${res.status}).`)
  }
  return json.data
}

/**
 * Starts a checkout for one billing cycle of one plan. amountKobo is
 * VAT-inclusive (see entitlements.js#amountInKoboWithVat) — Paystack's
 * `amount` is always in the currency's smallest unit (kobo for NGN).
 * `reference` must be unique per attempt; the caller generates it so it
 * can be recorded in billing_transactions before redirecting, closing the
 * gap where a user pays but the webhook arrives before any local row
 * exists to reconcile it against.
 */
async function createCheckout({ email, amountKobo, reference, callbackUrl, metadata }) {
  return paystackFetch('/transaction/initialize', {
    method: 'POST',
    body: { email, amount: amountKobo, reference, callback_url: callbackUrl, metadata, currency: 'NGN' },
  })
}

/** Server-side verification — the only verification this system trusts. A frontend "payment successful" redirect is never sufficient on its own. */
async function verifyPayment(reference) {
  return paystackFetch(`/transaction/verify/${encodeURIComponent(reference)}`)
}

async function getTransactions({ customerCode, perPage = 50 } = {}) {
  const qs = customerCode ? `?customer=${encodeURIComponent(customerCode)}&perPage=${perPage}` : `?perPage=${perPage}`
  return paystackFetch(`/transaction${qs}`)
}

async function cancelSubscription({ subscriptionCode, emailToken }) {
  return paystackFetch('/subscription/disable', {
    method: 'POST',
    body: { code: subscriptionCode, token: emailToken },
  })
}

async function getSubscription(subscriptionCode) {
  return paystackFetch(`/subscription/${encodeURIComponent(subscriptionCode)}`)
}

/**
 * Verifies the `x-paystack-signature` header: HMAC-SHA512 of the raw
 * request body, keyed with the secret key. This is the ONLY thing that
 * makes a POST to /api/billing/webhook trustworthy — without it, anyone
 * who finds the URL could mark any subscription paid. Constant-time
 * comparison so a timing attack can't be used to guess the signature
 * byte by byte.
 */
function verifyWebhookSignature(rawBody, signatureHeader) {
  if (!signatureHeader) return false
  const expected = crypto.createHmac('sha512', getSecretKey()).update(rawBody).digest('hex')
  const a = Buffer.from(expected, 'utf8')
  const b = Buffer.from(String(signatureHeader), 'utf8')
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

module.exports = {
  name: 'paystack',
  createCheckout,
  verifyPayment,
  getTransactions,
  cancelSubscription,
  getSubscription,
  verifyWebhookSignature,
}
