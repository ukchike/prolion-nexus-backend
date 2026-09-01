/**
 * Backend-side entitlement enforcement — the part the frontend cannot be
 * trusted to do itself. Everything here calls the database functions
 * defined in supabase/sql/048_billing_and_entitlements.sql through the
 * service-role client, because those functions read company_members and
 * subscriptions across RLS boundaries by design (a staff member with no
 * direct grant on 'settings.plan' must still be blocked by a real limit,
 * not merely denied a screen that shows it).
 */
const { getAdminClient } = require('./supabaseAdmin')

class EntitlementError extends Error {
  constructor(message, { status = 402, upgradeMetric = null } = {}) {
    super(message)
    this.name = 'EntitlementError'
    this.status = status
    this.upgradeMetric = upgradeMetric
  }
}

/** Confirms req.user is an ACTIVE member of companyId, returning their membership row. Throws 403 otherwise. */
async function assertCompanyMembership(userId, companyId) {
  if (!companyId || typeof companyId !== 'string') {
    throw new EntitlementError('A companyId is required.', { status: 400 })
  }
  const supabaseAdmin = getAdminClient()
  const { data, error } = await supabaseAdmin
    .from('company_members')
    .select('id, role, status, permissions')
    .eq('company_id', companyId)
    .eq('user_id', userId)
    .eq('status', 'active')
    .maybeSingle()
  if (error) throw error
  if (!data) {
    throw new EntitlementError('You are not an active member of this company.', { status: 403 })
  }
  return data
}

/** Reads the effective plan + both resettable usage counters for a company, for display (Billing settings). */
async function getEntitlementSnapshot(companyId) {
  const supabaseAdmin = getAdminClient()
  const { data: planKey, error: planErr } = await supabaseAdmin.rpc('effective_plan', { p_company: companyId })
  if (planErr) throw planErr

  const { data: plan, error: planRowErr } = await supabaseAdmin
    .from('subscription_plans')
    .select('*')
    .eq('key', planKey)
    .single()
  if (planRowErr) throw planRowErr

  const { data: owner } = await supabaseAdmin.rpc('company_owner', { p_company: companyId })

  const [statementsUsage, aiUsage, companiesUsed, usersUsed] = await Promise.all([
    supabaseAdmin.rpc('current_usage', { p_owner: owner, p_metric: 'bank_statements' }),
    supabaseAdmin.rpc('current_usage', { p_owner: owner, p_metric: 'ai_credits' }),
    supabaseAdmin.rpc('companies_used', { p_owner: owner }),
    supabaseAdmin.rpc('users_used', { p_company: companyId }),
  ])

  return {
    plan,
    usage: {
      bank_statements: { used: Number(statementsUsage.data || 0), limit: plan.limits.bank_statements ?? null },
      ai_credits: { used: Number(aiUsage.data || 0), limit: plan.limits.ai_credits ?? null },
      companies: { used: Number(companiesUsed.data || 0), limit: plan.limits.companies ?? null },
      users: { used: Number(usersUsed.data || 0), limit: plan.limits.users ?? null },
    },
  }
}

/**
 * Checks and consumes AI credits for a company's owner, atomically, and
 * logs the detail row. Throws EntitlementError (402) when the plan's
 * monthly allowance is exhausted — the caller must not proceed to the
 * paid AI request in that case.
 */
async function consumeAiCredits({ companyId, userId, feature, amount = 1, tokensEstimate = null }) {
  const supabaseAdmin = getAdminClient()
  const { data: owner, error: ownerErr } = await supabaseAdmin.rpc('company_owner', { p_company: companyId })
  if (ownerErr) throw ownerErr
  if (!owner) {
    // No resolvable owner is a data anomaly, not a reason to block a
    // legitimate request — fail open rather than wedge every AI feature.
    return { allowed: true, used: 0, limit: null }
  }

  const { data, error } = await supabaseAdmin.rpc('consume_usage', {
    p_owner: owner, p_metric: 'ai_credits', p_amount: amount,
  })
  if (error) throw error
  const result = Array.isArray(data) ? data[0] : data

  // limit_value, not limit — LIMIT is a reserved word, so consume_usage's
  // third OUT column is named limit_value (see the migration).
  if (!result.allowed) {
    throw new EntitlementError(
      `Monthly AI credit allowance reached (${result.used} of ${result.limit_value} used). Upgrade your plan for more, or wait for next month's reset.`,
      { status: 402, upgradeMetric: 'ai_credits' }
    )
  }

  await supabaseAdmin.from('ai_usage_log').insert({
    owner_user_id: owner, company_id: companyId, user_id: userId,
    feature, credits: amount, tokens_estimate: tokensEstimate,
  })

  return result
}

/** Pre-flight check before spending effort parsing a statement file — the authoritative cap is the DB trigger on insert, this just fails fast. */
async function assertStatementUploadAllowed(companyId) {
  const supabaseAdmin = getAdminClient()
  const { data: owner } = await supabaseAdmin.rpc('company_owner', { p_company: companyId })
  if (!owner) return
  const { data: limit } = await supabaseAdmin.rpc('plan_limit', { p_company: companyId, p_metric: 'bank_statements' })
  if (limit === null) return
  const { data: used } = await supabaseAdmin.rpc('current_usage', { p_owner: owner, p_metric: 'bank_statements' })
  if (Number(used || 0) >= limit) {
    throw new EntitlementError(
      `Monthly bank statement upload limit reached (${used} of ${limit} used this month). Upgrade your plan to upload more.`,
      { status: 402, upgradeMetric: 'bank_statements' }
    )
  }
}

async function assertFeature(companyId, featureKey, label) {
  const supabaseAdmin = getAdminClient()
  const { data: allowed, error } = await supabaseAdmin.rpc('plan_feature', { p_company: companyId, p_feature: featureKey })
  if (error) throw error
  if (!allowed) {
    throw new EntitlementError(`${label || featureKey} is not available on this plan.`, { status: 402, upgradeMetric: featureKey })
  }
}

module.exports = {
  EntitlementError,
  assertCompanyMembership,
  getEntitlementSnapshot,
  consumeAiCredits,
  assertStatementUploadAllowed,
  assertFeature,
}
