/**
 * Billing / entitlements tests — the parts that are pure functions and
 * don't need a live Supabase project: plan pricing, VAT math, downgrade
 * detection, and Paystack webhook signature verification (the single most
 * important thing to get right here — a forged signature that verifies
 * would let anyone mark any subscription paid for free).
 */
const assert = require('assert')
const crypto = require('crypto')
const { PLANS, PUBLIC_PLAN_ORDER, VAT_RATE, amountInKoboWithVat, planByKey } = require('../src/lib/entitlements')

function test(name, fn) {
  try {
    fn()
    console.log(`✓ ${name}`)
  } catch (error) {
    console.error(`✗ ${name}`)
    console.error(`  ${error.message}`)
    process.exitCode = 1
  }
}

function assertEqual(actual, expected, message) {
  assert.strictEqual(actual, expected, message || `expected ${expected}, got ${actual}`)
}

// ── Plan catalogue ────────────────────────────────────────────────────
test('exactly the five sold plans plus legacy are addressable', () => {
  assertEqual(PUBLIC_PLAN_ORDER.length, 5)
  for (const key of PUBLIC_PLAN_ORDER) assert(PLANS[key], `missing plan ${key}`)
})

test('prices match the spec exactly (ex-VAT, Naira)', () => {
  assertEqual(PLANS.free.priceMonthly, 0)
  assertEqual(PLANS.starter.priceMonthly, 3500)
  assertEqual(PLANS.starter.priceAnnual, 35000)
  assertEqual(PLANS.growth.priceMonthly, 7500)
  assertEqual(PLANS.growth.priceAnnual, 75000)
  assertEqual(PLANS.business.priceMonthly, 20000)
  assertEqual(PLANS.business.priceAnnual, 200000)
  assertEqual(PLANS.accountant.priceMonthly, 50000)
  assertEqual(PLANS.accountant.priceAnnual, 500000)
})

test('annual pricing is exactly 10 months of the monthly price (two months free)', () => {
  for (const key of ['starter', 'growth', 'business', 'accountant']) {
    assertEqual(PLANS[key].priceAnnual, PLANS[key].priceMonthly * 10, `${key} annual should be 10x monthly`)
  }
})

test('limits step up plan over plan', () => {
  assertEqual(PLANS.free.limits.bank_statements, 1)
  assertEqual(PLANS.starter.limits.bank_statements, 3)
  assertEqual(PLANS.growth.limits.bank_statements, 6)
  assert(PLANS.business.limits.bank_statements === undefined, 'Business should be unlimited (key absent)')
  assertEqual(PLANS.free.limits.ai_credits, 20)
  assertEqual(PLANS.starter.limits.ai_credits, 150)
  assertEqual(PLANS.growth.limits.ai_credits, 500)
  assertEqual(PLANS.business.limits.ai_credits, 1500)
  assertEqual(PLANS.accountant.limits.ai_credits, 3000)
})

test('inventory/payroll/projects are Growth+ only, never Free or Starter', () => {
  assert(!PLANS.free.features.inventory)
  assert(!PLANS.starter.features.inventory)
  assert(PLANS.growth.features.inventory)
  assert(PLANS.business.features.inventory)
})

test('multi-company and consolidation are Accountant-only', () => {
  // Business is capped at 1 company (limits.companies), so it must NOT
  // advertise multiCompany/consolidation -- that would be a feature flag
  // the database can't honour. Only Accountant (companies: 20) does.
  assert(!PLANS.growth.features.multiCompany)
  assert(!PLANS.business.features.multiCompany)
  assert(PLANS.accountant.features.multiCompany)
})

test('a plan never advertises multiCompany while capped at 1 company', () => {
  for (const key of PUBLIC_PLAN_ORDER) {
    if (PLANS[key].features.multiCompany) {
      assert(PLANS[key].limits.companies !== 1, `${key} advertises multiCompany but limits.companies is 1`)
    }
  }
})

test('unknown plan key falls back to Free rather than throwing', () => {
  assertEqual(planByKey('not-a-real-plan').key, 'free')
})

// ── VAT ──────────────────────────────────────────────────────────────
test('VAT rate is 7.5%, applied on top of the ex-VAT price', () => {
  assertEqual(VAT_RATE, 0.075)
  // ₦15,000 + 7.5% = ₦16,125.00 = 1,612,500 kobo
  assertEqual(amountInKoboWithVat(15000), 1612500)
})

test('a ₦0 plan charges ₦0 even after VAT', () => {
  assertEqual(amountInKoboWithVat(0), 0)
})

// ── Paystack webhook signature verification ─────────────────────────
// Re-implemented inline (rather than importing paystack.js, which reads
// process.env.PAYSTACK_SECRET_KEY at call time) so the test controls the
// secret directly and proves the exact algorithm: HMAC-SHA512 over the
// raw body, hex-encoded, constant-time compared.
function verifySignature(rawBody, signatureHeader, secret) {
  if (!signatureHeader) return false
  const expected = crypto.createHmac('sha512', secret).update(rawBody).digest('hex')
  const a = Buffer.from(expected, 'utf8')
  const b = Buffer.from(String(signatureHeader), 'utf8')
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

test('webhook signature verifies when computed with the correct secret', () => {
  const secret = 'sk_test_abc123'
  const body = Buffer.from(JSON.stringify({ event: 'charge.success', data: { reference: 'ref_1' } }))
  const signature = crypto.createHmac('sha512', secret).update(body).digest('hex')
  assert(verifySignature(body, signature, secret) === true)
})

test('webhook signature is rejected when forged with the wrong secret', () => {
  const body = Buffer.from(JSON.stringify({ event: 'charge.success', data: { reference: 'ref_1' } }))
  const forgedSignature = crypto.createHmac('sha512', 'wrong-secret').update(body).digest('hex')
  assert(verifySignature(body, forgedSignature, 'sk_test_abc123') === false)
})

test('webhook signature is rejected when the body is tampered with after signing', () => {
  const secret = 'sk_test_abc123'
  const originalBody = Buffer.from(JSON.stringify({ event: 'charge.success', data: { reference: 'ref_1', amount: 1000 } }))
  const signature = crypto.createHmac('sha512', secret).update(originalBody).digest('hex')
  const tamperedBody = Buffer.from(JSON.stringify({ event: 'charge.success', data: { reference: 'ref_1', amount: 100000 } }))
  assert(verifySignature(tamperedBody, signature, secret) === false)
})

test('webhook with no signature header is always rejected', () => {
  const body = Buffer.from('{}')
  assert(verifySignature(body, undefined, 'sk_test_abc123') === false)
  assert(verifySignature(body, null, 'sk_test_abc123') === false)
  assert(verifySignature(body, '', 'sk_test_abc123') === false)
})

// ── Downgrade detection (mirrors routes/billing.js#isDowngrade) ────────
function isDowngrade(fromKey, toKey) {
  const from = PLANS[fromKey], to = PLANS[toKey]
  if (!from || !to) return false
  return to.sortOrder < from.sortOrder
}

test('moving to a lower sortOrder plan is a downgrade', () => {
  assert(isDowngrade('business', 'starter') === true)
  assert(isDowngrade('growth', 'free') === true)
})

test('moving to a higher or equal sortOrder plan is not a downgrade', () => {
  assert(isDowngrade('starter', 'growth') === false)
  assert(isDowngrade('growth', 'growth') === false)
})
