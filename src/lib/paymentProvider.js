/**
 * PaymentProvider selection point. Every provider module exports the same
 * shape (createCheckout, verifyPayment, getTransactions, cancelSubscription,
 * getSubscription, verifyWebhookSignature) — see paystack.js for the
 * canonical implementation and the reasoning behind each method.
 *
 * Adding Flutterwave later is: write src/lib/flutterwave.js to the same
 * shape, add it to PROVIDERS below, set PAYMENT_PROVIDER=flutterwave.
 * routes/billing.js never changes.
 */
const paystack = require('./paystack')

const PROVIDERS = { paystack }

function getPaymentProvider() {
  const name = process.env.PAYMENT_PROVIDER || 'paystack'
  const provider = PROVIDERS[name]
  if (!provider) {
    throw new Error(`Unknown PAYMENT_PROVIDER "${name}". Supported: ${Object.keys(PROVIDERS).join(', ')}.`)
  }
  return provider
}

module.exports = { getPaymentProvider }
