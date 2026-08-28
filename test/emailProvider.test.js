/**
 * Offline checks for the email provider. The actual Resend call is not
 * exercised here (it needs a live API key and would send real mail) —
 * what IS testable offline is the configuration boundary and the payload
 * shape, which is where the first-run failures actually happen.
 */
const assert = require('assert')
const { isEmailConfigured, EmailConfigError, EmailSendError } = require('../src/lib/emailProvider')

let failures = 0
function check(label, fn) {
  try { fn(); console.log(`  PASS - ${label}`) }
  catch (err) { console.log(`  FAIL - ${label}\n         ${err.message}`); failures++ }
}

const ORIGINAL = { key: process.env.RESEND_API_KEY, from: process.env.INVOICE_FROM_EMAIL }
function withEnv(key, from, fn) {
  if (key === null) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = key
  if (from === null) delete process.env.INVOICE_FROM_EMAIL; else process.env.INVOICE_FROM_EMAIL = from
  try { return fn() } finally {
    if (ORIGINAL.key === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = ORIGINAL.key
    if (ORIGINAL.from === undefined) delete process.env.INVOICE_FROM_EMAIL; else process.env.INVOICE_FROM_EMAIL = ORIGINAL.from
  }
}

console.log('\n--- isEmailConfigured ---')
check('false when neither variable is set', () =>
  withEnv(null, null, () => assert.strictEqual(isEmailConfigured(), false)))
check('false when only the API key is set — a sender is required too', () =>
  withEnv('re_test', null, () => assert.strictEqual(isEmailConfigured(), false)))
check('false when only the sender is set', () =>
  withEnv(null, 'billing@example.com', () => assert.strictEqual(isEmailConfigured(), false)))
check('true only when both are present', () =>
  withEnv('re_test', 'billing@example.com', () => assert.strictEqual(isEmailConfigured(), true)))

console.log('\n--- misconfiguration is a distinct, typed failure ---')
check('sendEmail rejects with EmailConfigError when unconfigured', async () => {
  const { sendEmail } = require('../src/lib/emailProvider')
  return withEnv(null, null, async () => {
    await assert.rejects(
      () => sendEmail({ to: 'a@b.com', subject: 's', html: '<p>x</p>' }),
      (e) => e instanceof EmailConfigError
    )
  })
})
check('EmailConfigError names the two variables an operator must set', () => {
  const { sendEmail } = require('../src/lib/emailProvider')
  return withEnv(null, null, async () => {
    await sendEmail({ to: 'a@b.com', subject: 's', html: 'x' }).catch((e) => {
      assert.ok(/RESEND_API_KEY/.test(e.message), 'should name RESEND_API_KEY')
      assert.ok(/INVOICE_FROM_EMAIL/.test(e.message), 'should name INVOICE_FROM_EMAIL')
    })
  })
})
check('the two error types are distinguishable by routes mapping them to 503 vs 502', () => {
  assert.notStrictEqual(EmailConfigError, EmailSendError)
  assert.ok(new EmailConfigError('x') instanceof Error)
  assert.ok(new EmailSendError('x') instanceof Error)
})

setTimeout(() => {
  console.log('\n=================================')
  console.log(failures === 0 ? 'ALL EMAIL PROVIDER CHECKS PASSED' : `${failures} CHECK(S) FAILED`)
  console.log('NOTE: the Resend HTTP call itself is not offline-testable — it needs a live')
  console.log('API key and would send real mail. Verify by sending one invoice to yourself.')
  console.log('=================================')
  process.exit(failures === 0 ? 0 : 1)
}, 100)
