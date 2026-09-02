/**
 * Subscriptions, checkout, webhook and plan changes.
 *
 * A subscription belongs to the PAYING account (req.user.id as
 * owner_user_id in `subscriptions`), not to any one company — see the
 * comment at the top of supabase/sql/048_billing_and_entitlements.sql.
 * Every route here that reads or changes billing state operates on the
 * caller's own subscription; company-scoped reads (usage, current plan
 * for a specific company) additionally verify company membership via
 * entitlementService.
 */
const express = require('express')
const crypto = require('crypto')
const { requireAuth } = require('../middleware/requireAuth')
const { getAdminClient } = require('../lib/supabaseAdmin')
const { getPaymentProvider } = require('../lib/paymentProvider')
const { PLANS, PUBLIC_PLAN_ORDER, VAT_RATE, amountInKoboWithVat } = require('../lib/entitlements')
const { assertCompanyMembership, getEntitlementSnapshot, EntitlementError } = require('../lib/entitlementService')

const router = express.Router()

const ACTIVE_STATUSES = ['trialing', 'active', 'past_due', 'grace_period']

function isDowngrade(fromKey, toKey) {
  const from = PLANS[fromKey], to = PLANS[toKey]
  if (!from || !to) return false
  return to.sortOrder < from.sortOrder
}

// ── Public plan catalogue — the pricing page reads this, not the DB, so it renders with zero auth and zero round trip. ──
router.get('/billing/plans', (req, res) => {
  const plans = PUBLIC_PLAN_ORDER.map((key) => {
    const p = PLANS[key]
    return {
      key: p.key, name: p.name, sortOrder: p.sortOrder,
      priceMonthly: p.priceMonthly, priceAnnual: p.priceAnnual,
      priceMonthlyVatInclusive: Math.round(p.priceMonthly * (1 + VAT_RATE)),
      priceAnnualVatInclusive: Math.round(p.priceAnnual * (1 + VAT_RATE)),
      extraUnitPrice: p.extraUnitPrice || null, extraUnitLabel: p.extraUnitLabel || null,
      limits: p.limits, features: p.features,
    }
  })
  res.json({ plans, vatRate: VAT_RATE })
})

// ── Current subscription + usage for a company the caller belongs to ──
router.get('/billing/subscription', requireAuth, async (req, res) => {
  try {
    const companyId = req.query.companyId
    await assertCompanyMembership(req.user.id, companyId)
    const supabaseAdmin = getAdminClient()

    const { data: owner } = await supabaseAdmin.rpc('company_owner', { p_company: companyId })
    const { data: subscription } = await supabaseAdmin
      .from('subscriptions')
      .select('*')
      .eq('owner_user_id', owner)
      .maybeSingle()

    const snapshot = await getEntitlementSnapshot(companyId)

    const { data: transactions } = await supabaseAdmin
      .from('billing_transactions')
      .select('id, reference, amount, currency, status, plan_key, billing_cycle, paid_at, created_at')
      .eq('owner_user_id', owner)
      .order('created_at', { ascending: false })
      .limit(20)

    res.json({
      isOwner: owner === req.user.id,
      subscription: subscription || null,
      plan: snapshot.plan,
      usage: snapshot.usage,
      transactions: transactions || [],
    })
  } catch (err) {
    if (err instanceof EntitlementError) return res.status(err.status).json({ error: err.message })
    console.error('Billing subscription error:', err)
    res.status(500).json({ error: err.message || 'Could not load subscription.' })
  }
})

// ── Start (or upgrade) a subscription — always goes through a fresh checkout, since Paystack needs a charge for the new amount. ──
router.post('/billing/checkout', requireAuth, async (req, res) => {
  try {
    const { planKey, billingCycle, companyId } = req.body || {}
    if (!PLANS[planKey] || planKey === 'free' || planKey === 'legacy') {
      return res.status(400).json({ error: 'Unknown or unbuyable plan.' })
    }
    if (!['monthly', 'annual'].includes(billingCycle)) {
      return res.status(400).json({ error: 'billingCycle must be "monthly" or "annual".' })
    }
    if (companyId) await assertCompanyMembership(req.user.id, companyId)

    const plan = PLANS[planKey]
    const naira = billingCycle === 'annual' ? plan.priceAnnual : plan.priceMonthly
    const amountKobo = amountInKoboWithVat(naira)
    const reference = `prixum_${planKey}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`

    const supabaseAdmin = getAdminClient()
    const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(req.user.id)
    const email = authUser?.user?.email || req.user.email
    if (!email) return res.status(400).json({ error: 'Your account has no email on file — cannot start checkout.' })

    // Recorded as 'pending' BEFORE redirecting, so the webhook always has
    // a row to reconcile against even if it arrives before the user's
    // browser comes back from Paystack.
    await supabaseAdmin.from('billing_transactions').insert({
      owner_user_id: req.user.id, provider: 'paystack', reference,
      amount: amountKobo / 100, currency: 'NGN', status: 'pending',
      plan_key: planKey, billing_cycle: billingCycle,
    })

    const provider = getPaymentProvider()
    const checkout = await provider.createCheckout({
      email, amountKobo, reference,
      callbackUrl: process.env.BILLING_CALLBACK_URL || undefined,
      metadata: { ownerUserId: req.user.id, planKey, billingCycle, companyId: companyId || null },
    })

    res.json({ authorizationUrl: checkout.authorization_url, reference, accessCode: checkout.access_code })
  } catch (err) {
    if (err instanceof EntitlementError) return res.status(err.status).json({ error: err.message })
    console.error('Checkout error:', err)
    res.status(500).json({ error: err.message || 'Could not start checkout.' })
  }
})

// ── Manual verification (the page the user lands back on after paying calls this) — never trusts the redirect itself. ──
router.get('/billing/verify', requireAuth, async (req, res) => {
  try {
    const { reference } = req.query
    if (!reference) return res.status(400).json({ error: 'reference is required.' })
    const provider = getPaymentProvider()
    const data = await provider.verifyPayment(reference)
    if (data.status !== 'success') {
      return res.json({ verified: false, status: data.status })
    }
    await applySuccessfulPayment({ reference, providerData: data })
    res.json({ verified: true })
  } catch (err) {
    console.error('Verify error:', err)
    res.status(500).json({ error: err.message || 'Could not verify payment.' })
  }
})

// ── Webhook — the ONLY source this system actually trusts for "paid". ──
// Mounted with express.raw() in server.js (see the comment there) so
// req.body is the exact bytes Paystack signed, not a re-serialised copy
// that could hash differently.
router.post('/billing/webhook', async (req, res) => {
  try {
    const provider = getPaymentProvider()
    const signature = req.headers['x-paystack-signature']
    const rawBody = req.body // Buffer, thanks to express.raw()
    if (!provider.verifyWebhookSignature(rawBody, signature)) {
      console.warn('[billing webhook] signature verification failed')
      return res.status(401).json({ error: 'Invalid signature.' })
    }

    const event = JSON.parse(rawBody.toString('utf8'))
    const eventId = event?.data?.id ? String(event.data.id) : `${event.event}_${event?.data?.reference || Date.now()}`

    const supabaseAdmin = getAdminClient()
    // Idempotency: a duplicate delivery of the same event_id is a no-op.
    const { error: insertErr } = await supabaseAdmin
      .from('billing_events')
      .insert({ provider: 'paystack', event_type: event.event, event_id: eventId, payload: event })
    if (insertErr) {
      if (insertErr.code === '23505') {
        return res.status(200).json({ received: true, duplicate: true })
      }
      throw insertErr
    }

    if (event.event === 'charge.success') {
      await applySuccessfulPayment({ reference: event.data.reference, providerData: event.data })
    } else if (event.event === 'subscription.disable' || event.event === 'subscription.not_renew') {
      const customerCode = event.data?.customer?.customer_code
      if (customerCode) {
        await supabaseAdmin.from('subscriptions')
          .update({ cancel_at_period_end: true, updated_at: new Date().toISOString() })
          .eq('paystack_customer_code', customerCode)
      }
    }

    await supabaseAdmin.from('billing_events')
      .update({ processed_at: new Date().toISOString() })
      .eq('provider', 'paystack').eq('event_id', eventId)

    res.status(200).json({ received: true })
  } catch (err) {
    console.error('Webhook processing error:', err)
    // 200 even on an internal error we've already logged — Paystack will
    // retry a non-2xx response, and a retry storm on a bug in OUR code is
    // worse than losing one event we can reconcile manually via /verify.
    res.status(200).json({ received: true, error: 'processing_error' })
  }
})

/** Shared by both the webhook and the manual /verify fallback. */
async function applySuccessfulPayment({ reference, providerData }) {
  const supabaseAdmin = getAdminClient()
  const { data: txn } = await supabaseAdmin
    .from('billing_transactions')
    .select('*')
    .eq('provider', 'paystack').eq('reference', reference)
    .maybeSingle()

  if (!txn) {
    console.error(`[billing] No local billing_transactions row for reference ${reference} — cannot attribute this payment to an owner.`)
    return
  }
  if (txn.status === 'success') return // already applied

  await supabaseAdmin.from('billing_transactions')
    .update({ status: 'success', paid_at: new Date().toISOString(), raw: providerData })
    .eq('id', txn.id)

  const plan = PLANS[txn.plan_key]
  const periodLength = txn.billing_cycle === 'annual' ? { years: 1 } : { months: 1 }
  const now = new Date()
  const periodEnd = new Date(now)
  if (periodLength.years) periodEnd.setFullYear(periodEnd.getFullYear() + periodLength.years)
  else periodEnd.setMonth(periodEnd.getMonth() + periodLength.months)

  await supabaseAdmin.from('subscriptions').upsert({
    owner_user_id: txn.owner_user_id,
    plan_key: txn.plan_key,
    pending_plan_key: null,
    billing_cycle: txn.billing_cycle,
    status: 'active',
    current_period_start: now.toISOString(),
    current_period_end: periodEnd.toISOString(),
    cancel_at_period_end: false,
    paystack_customer_code: providerData?.customer?.customer_code || undefined,
    paystack_authorization_code: providerData?.authorization?.authorization_code || undefined,
    updated_at: now.toISOString(),
  }, { onConflict: 'owner_user_id' })

  console.log(`[billing] Activated ${plan?.name || txn.plan_key} for owner ${txn.owner_user_id} (ref ${reference})`)
}

// ── Downgrade (scheduled for next renewal) or clear a pending downgrade. Upgrades go through /checkout instead — see isDowngrade(). ──
router.post('/billing/change-plan', requireAuth, async (req, res) => {
  try {
    const { planKey } = req.body || {}
    if (!PLANS[planKey]) return res.status(400).json({ error: 'Unknown plan.' })

    const supabaseAdmin = getAdminClient()
    const { data: subscription, error } = await supabaseAdmin
      .from('subscriptions').select('*').eq('owner_user_id', req.user.id).maybeSingle()
    if (error) throw error
    if (!subscription) return res.status(404).json({ error: 'No active subscription found.' })

    if (planKey === subscription.plan_key) {
      await supabaseAdmin.from('subscriptions')
        .update({ pending_plan_key: null, updated_at: new Date().toISOString() })
        .eq('owner_user_id', req.user.id)
      return res.json({ scheduled: false, message: 'Pending plan change cleared.' })
    }

    if (!isDowngrade(subscription.plan_key, planKey)) {
      return res.status(400).json({ error: 'Upgrades are applied immediately through checkout — use /billing/checkout.' })
    }

    // Incompatible-usage check — never silently delete data.
    const targetLimits = PLANS[planKey].limits
    const { data: ownedCompanies } = await supabaseAdmin
      .from('company_members')
      .select('company_id, company_profiles(legal_name)')
      .eq('user_id', req.user.id).eq('role', 'owner').eq('status', 'active')

    const issues = []
    if (targetLimits.companies != null && (ownedCompanies || []).length > targetLimits.companies) {
      issues.push({
        type: 'companies', limit: targetLimits.companies, used: ownedCompanies.length,
        message: `The ${PLANS[planKey].name} plan supports ${targetLimits.companies} compan${targetLimits.companies === 1 ? 'y' : 'ies'}; you have ${ownedCompanies.length}. Choose which should remain active before this downgrade takes effect.`,
      })
    }
    for (const c of ownedCompanies || []) {
      if (targetLimits.users == null) continue
      const { data: userCount } = await supabaseAdmin.rpc('users_used', { p_company: c.company_id })
      if (Number(userCount) > targetLimits.users) {
        issues.push({
          type: 'users', companyId: c.company_id, companyName: c.company_profiles?.legal_name,
          limit: targetLimits.users, used: Number(userCount),
          message: `"${c.company_profiles?.legal_name}" has ${userCount} team members; the ${PLANS[planKey].name} plan supports ${targetLimits.users}. Remove team members before this downgrade takes effect.`,
        })
      }
    }

    if (issues.length > 0) {
      return res.status(409).json({ error: 'This downgrade is blocked by current usage.', issues })
    }

    // Scheduled, not immediate — the customer keeps what they paid for
    // until the period they already paid for ends.
    await supabaseAdmin.from('subscriptions')
      .update({ pending_plan_key: planKey, updated_at: new Date().toISOString() })
      .eq('owner_user_id', req.user.id)

    res.json({ scheduled: true, effectiveAt: subscription.current_period_end })
  } catch (err) {
    console.error('Change-plan error:', err)
    res.status(500).json({ error: err.message || 'Could not change plan.' })
  }
})

router.post('/billing/cancel', requireAuth, async (req, res) => {
  try {
    const supabaseAdmin = getAdminClient()
    const { data: subscription } = await supabaseAdmin
      .from('subscriptions').select('*').eq('owner_user_id', req.user.id).maybeSingle()
    if (!subscription) return res.status(404).json({ error: 'No active subscription found.' })

    if (subscription.paystack_subscription_code) {
      try {
        const provider = getPaymentProvider()
        await provider.cancelSubscription({ subscriptionCode: subscription.paystack_subscription_code })
      } catch (err) {
        // Paystack side failing (already cancelled there, etc.) should not
        // block the customer's own record of "I cancelled" — log and continue.
        console.warn('Provider cancelSubscription failed (continuing locally):', err.message)
      }
    }

    await supabaseAdmin.from('subscriptions')
      .update({ cancel_at_period_end: true, updated_at: new Date().toISOString() })
      .eq('owner_user_id', req.user.id)

    res.json({ cancelled: true, accessUntil: subscription.current_period_end })
  } catch (err) {
    console.error('Cancel error:', err)
    res.status(500).json({ error: err.message || 'Could not cancel subscription.' })
  }
})

module.exports = router
