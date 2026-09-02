/**
 * The five sold PRIXUM plans plus the internal 'legacy' grandfather plan —
 * mirrors supabase/sql/048_billing_and_entitlements.sql's seed exactly.
 * That migration is the actual source of truth (it's what the database
 * enforces); this copy exists so the backend can price a Paystack
 * checkout and pre-check a limit without a database round trip. The two
 * MUST be changed together — the discipline the now-removed seatLimits.js
 * (a single-tier seat cap this supersedes) used to document in its place.
 *
 * Prices are NGN, VAT-exclusive (the amounts PRIXUM was priced in).
 */
const VAT_RATE = 0.075

const PLANS = {
  free: {
    key: 'free', name: 'Free', sortOrder: 0,
    priceMonthly: 0, priceAnnual: 0,
    limits: { companies: 1, users: 1, bank_statements: 1, ai_credits: 20 },
    features: { sales: true, basicReports: true },
  },
  starter: {
    key: 'starter', name: 'Starter', sortOrder: 1,
    priceMonthly: 3500, priceAnnual: 35000,
    limits: { companies: 1, users: 2, bank_statements: 3, ai_credits: 150 },
    features: {
      sales: true, purchases: true, reconciliation: true, nrsVatExport: true,
      statementExport: true, aiAssistant: true, emailInvoices: true, auditTrail: true,
    },
  },
  growth: {
    key: 'growth', name: 'Growth', sortOrder: 2,
    priceMonthly: 7500, priceAnnual: 75000,
    limits: { companies: 1, users: 5, bank_statements: 6, ai_credits: 500 },
    features: {
      sales: true, purchases: true, reconciliation: true, nrsVatExport: true,
      statementExport: true, aiAssistant: true, emailInvoices: true, auditTrail: true,
      inventory: true, payroll: true, projects: true, payeExport: true, budgets: true,
      advancedReports: true, advancedAI: true, periodComparison: true,
    },
  },
  business: {
    key: 'business', name: 'Business', sortOrder: 3,
    priceMonthly: 20000, priceAnnual: 200000,
    // bank_statements deliberately absent — unlimited, subject to the
    // rate limiters already in front of every route.
    limits: { companies: 1, users: 10, ai_credits: 1500 },
    features: {
      sales: true, purchases: true, reconciliation: true, nrsVatExport: true,
      statementExport: true, aiAssistant: true, emailInvoices: true, auditTrail: true,
      inventory: true, payroll: true, projects: true, payeExport: true, budgets: true,
      advancedReports: true, advancedAI: true, periodComparison: true,
      // NOT multiCompany/consolidation — Business is capped at 1 company,
      // so advertising a multi-company feature it cannot use would be
      // exactly the kind of promise the database won't honour. Only
      // Accountant (companies: 20) genuinely supports more than one.
      advancedPermissions: true,
      approvalWorkflows: true, advancedAuditLog: true, periodLock: true,
    },
  },
  accountant: {
    key: 'accountant', name: 'Accountant', sortOrder: 4,
    priceMonthly: 50000, priceAnnual: 500000,
    extraUnitPrice: 1500, extraUnitLabel: 'company/month beyond the included 20',
    limits: { companies: 20, users: 10, ai_credits: 3000 },
    features: {
      sales: true, purchases: true, reconciliation: true, nrsVatExport: true,
      statementExport: true, aiAssistant: true, emailInvoices: true, auditTrail: true,
      inventory: true, payroll: true, projects: true, payeExport: true, budgets: true,
      advancedReports: true, advancedAI: true, periodComparison: true,
      multiCompany: true, consolidation: true, advancedPermissions: true,
      approvalWorkflows: true, advancedAuditLog: true, periodLock: true,
      accountantWorkspace: true, whiteLabel: true,
    },
  },
}

const PUBLIC_PLAN_ORDER = ['free', 'starter', 'growth', 'business', 'accountant']

function planByKey(key) {
  return PLANS[key] || PLANS.free
}

/** VAT-inclusive amount for a given ex-VAT Naira price, in kobo (Paystack wants kobo). */
function amountInKoboWithVat(nairaExVat) {
  const withVat = Math.round(nairaExVat * (1 + VAT_RATE) * 100) / 100
  return Math.round(withVat * 100)
}

module.exports = { PLANS, PUBLIC_PLAN_ORDER, VAT_RATE, planByKey, amountInKoboWithVat }
