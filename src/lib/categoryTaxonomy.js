/**
 * Category taxonomy for NEXUS — 46 categories total.
 * Aligned to a real FIRS CIT computation template, then consolidated
 * per user instruction: Operating Expenses capped at 20 (from an
 * initial 51-category full-granularity pass), Balance Sheet capped at
 * 16 (from 19, merging three paired movements — direction remains
 * recoverable from debit/credit). CIT-sensitive categories (Fines &
 * Penalties, Donations, CSR, Entertainment) kept distinct regardless of
 * caps since they're not fully tax-deductible. Other Income remains a
 * single catch-all per explicit user decision.
 */

const CATEGORY_GROUPS = {
  INCOME: 'INCOME',
  EXPENSE: 'EXPENSE',
  BALANCE_SHEET: 'BALANCE_SHEET',
  TRANSFER: 'TRANSFER',
  UNCLASSIFIED: 'UNCLASSIFIED',
}

const BALANCE_SHEET_SUBGROUPS = {
  NON_CURRENT_ASSETS: 'NON_CURRENT_ASSETS',
  CURRENT_ASSETS: 'CURRENT_ASSETS',
  CURRENT_LIABILITIES: 'CURRENT_LIABILITIES',
  NON_CURRENT_LIABILITIES: 'NON_CURRENT_LIABILITIES',
  EQUITY: 'EQUITY',
}

const EXPENSE_SUBGROUPS = {
  COST_OF_SALES: 'COST_OF_SALES',
  OPERATING: 'OPERATING',
  // Sits BELOW Operating Profit in the P&L waterfall, outside the
  // 20-item Operating cap. Created after analysing Dufry Duty Free's
  // real FY2023 AFS: a N5.33bn exchange loss against an operating base
  // of a few hundred million — burying that in Operating Expenses would
  // make Operating Profit (the "is the core business viable?" line)
  // swing on currency volatility unrelated to operations. Interest
  // Expense deliberately STAYS in Operating per user decision (most
  // target SME clients carry little debt; simplicity wins there).
  NON_OPERATING: 'NON_OPERATING',
}

const INCOME_CATEGORIES = [
  'Sales Revenue',
  'Service Income',
  'Rental Income',
  'Foreign Exchange Gain',
  // FX Gain is standalone (not folded into Other Income) because real
  // reference AFS show it at material scale (Allied Foods: N470m;
  // Smarterise: N4.25m) — too large to bury in a catch-all. Presented
  // under income per the user's direction, mirroring how Smarterise and
  // Allied Foods themselves present exchange gains.
  'Other Income',
]

const EXPENSE_CATEGORY_DEFINITIONS = [
  // Cost of Sales (4, deliberately broad)
  { name: 'Cost of Goods Sold (Purchases)', subgroup: EXPENSE_SUBGROUPS.COST_OF_SALES },
  { name: 'Direct Wages', subgroup: EXPENSE_SUBGROUPS.COST_OF_SALES },
  { name: 'Direct Expenses (incl. Carriage Inwards)', subgroup: EXPENSE_SUBGROUPS.COST_OF_SALES },
  { name: 'Other Direct Costs', subgroup: EXPENSE_SUBGROUPS.COST_OF_SALES },

  // Operating (20, consolidated from 51)
  { name: 'Staff Salaries & Wages', subgroup: EXPENSE_SUBGROUPS.OPERATING },
  { name: "Directors' Remuneration", subgroup: EXPENSE_SUBGROUPS.OPERATING },
  { name: 'Staff Welfare, Gratuity & Pension', subgroup: EXPENSE_SUBGROUPS.OPERATING },
  { name: 'Rent & Utilities', subgroup: EXPENSE_SUBGROUPS.OPERATING },
  { name: 'Repairs, Security & Cleaning', subgroup: EXPENSE_SUBGROUPS.OPERATING },
  { name: 'Transport, Travel & Distribution', subgroup: EXPENSE_SUBGROUPS.OPERATING },
  { name: 'Marketing, Advertising & Promotions', subgroup: EXPENSE_SUBGROUPS.OPERATING },
  { name: 'Professional & Audit Fees', subgroup: EXPENSE_SUBGROUPS.OPERATING },
  { name: 'Government, Regulatory & Statutory Costs', subgroup: EXPENSE_SUBGROUPS.OPERATING },
  { name: 'Bank Charges', subgroup: EXPENSE_SUBGROUPS.OPERATING },
  { name: 'Interest Expense', subgroup: EXPENSE_SUBGROUPS.OPERATING },
  { name: 'Tax Payments', subgroup: EXPENSE_SUBGROUPS.OPERATING },
  { name: 'Fines & Penalties', subgroup: EXPENSE_SUBGROUPS.OPERATING },
  { name: 'Donations', subgroup: EXPENSE_SUBGROUPS.OPERATING },
  { name: 'Corporate Social Responsibility', subgroup: EXPENSE_SUBGROUPS.OPERATING },
  { name: 'Entertainment Expenses', subgroup: EXPENSE_SUBGROUPS.OPERATING },
  { name: 'Training & Development', subgroup: EXPENSE_SUBGROUPS.OPERATING },
  { name: 'Office Supplies & Stationery', subgroup: EXPENSE_SUBGROUPS.OPERATING },
  { name: 'Other Operating Expenses', subgroup: EXPENSE_SUBGROUPS.OPERATING },

  // Non-operating (below Operating Profit — see EXPENSE_SUBGROUPS note)
  { name: 'Foreign Exchange Loss', subgroup: EXPENSE_SUBGROUPS.NON_OPERATING },
]

const EXPENSE_CATEGORIES = EXPENSE_CATEGORY_DEFINITIONS.map((d) => d.name)

const BALANCE_SHEET_CATEGORY_DEFINITIONS = [
  { name: 'Capital Introduced', subgroup: BALANCE_SHEET_SUBGROUPS.EQUITY },
  { name: 'Owner/Director Withdrawal', subgroup: BALANCE_SHEET_SUBGROUPS.EQUITY },
  { name: 'Dividend Paid', subgroup: BALANCE_SHEET_SUBGROUPS.EQUITY },

  { name: 'Asset Purchase/Disposal', subgroup: BALANCE_SHEET_SUBGROUPS.NON_CURRENT_ASSETS },
  { name: 'Security Deposit Paid/Refund', subgroup: BALANCE_SHEET_SUBGROUPS.NON_CURRENT_ASSETS },

  { name: 'Staff & Director Loans (Advanced/Repaid)', subgroup: BALANCE_SHEET_SUBGROUPS.CURRENT_ASSETS },
  // Broadened from staff-only after the Hamptech reference case: a
  // director current account in DEBIT (director owes the company) is a
  // receivable under IFRS for SMEs S4/S11 — NOT a negative liability,
  // which is how Hamptech's own accountant mispresented a N51.28m debit
  // balance. Direction determines classification: debit -> here
  // (Current Assets); credit (director lends the company) -> routes to
  // 'Loan Received - Current' as a related-party loan. IAS 24 separate
  // disclosure happens at statement level, recoverable from description.
  { name: 'Intercompany Receivable', subgroup: BALANCE_SHEET_SUBGROUPS.CURRENT_ASSETS },
  { name: 'Trade Receivables Collected', subgroup: BALANCE_SHEET_SUBGROUPS.CURRENT_ASSETS },
  { name: 'Prepaid Expenses', subgroup: BALANCE_SHEET_SUBGROUPS.CURRENT_ASSETS },

  { name: 'Customer Advance / Deposit Received', subgroup: BALANCE_SHEET_SUBGROUPS.CURRENT_LIABILITIES },
  { name: 'Loan Received - Current', subgroup: BALANCE_SHEET_SUBGROUPS.CURRENT_LIABILITIES },
  { name: 'Loan Repayment - Principal (Current)', subgroup: BALANCE_SHEET_SUBGROUPS.CURRENT_LIABILITIES },
  { name: 'Intercompany Payable', subgroup: BALANCE_SHEET_SUBGROUPS.CURRENT_LIABILITIES },
  { name: 'Trade Payables Settled', subgroup: BALANCE_SHEET_SUBGROUPS.CURRENT_LIABILITIES },

  { name: 'Loan Received - Non-current', subgroup: BALANCE_SHEET_SUBGROUPS.NON_CURRENT_LIABILITIES },
  { name: 'Loan Repayment - Principal (Non-current)', subgroup: BALANCE_SHEET_SUBGROUPS.NON_CURRENT_LIABILITIES },
]

const BALANCE_SHEET_CATEGORIES = BALANCE_SHEET_CATEGORY_DEFINITIONS.map((d) => d.name)

const TRANSFER_CATEGORIES = ['Inter-account Transfer']
const UNCLASSIFIED_CATEGORIES = ['Uncategorised']

const ALL_CATEGORIES = [
  ...INCOME_CATEGORIES,
  ...EXPENSE_CATEGORIES,
  ...BALANCE_SHEET_CATEGORIES,
  ...TRANSFER_CATEGORIES,
  ...UNCLASSIFIED_CATEGORIES,
]

const CATEGORY_TO_GROUP = {}
INCOME_CATEGORIES.forEach((c) => (CATEGORY_TO_GROUP[c] = CATEGORY_GROUPS.INCOME))
EXPENSE_CATEGORIES.forEach((c) => (CATEGORY_TO_GROUP[c] = CATEGORY_GROUPS.EXPENSE))
BALANCE_SHEET_CATEGORIES.forEach((c) => (CATEGORY_TO_GROUP[c] = CATEGORY_GROUPS.BALANCE_SHEET))
TRANSFER_CATEGORIES.forEach((c) => (CATEGORY_TO_GROUP[c] = CATEGORY_GROUPS.TRANSFER))
UNCLASSIFIED_CATEGORIES.forEach((c) => (CATEGORY_TO_GROUP[c] = CATEGORY_GROUPS.UNCLASSIFIED))

const CATEGORY_TO_BALANCE_SHEET_SUBGROUP = {}
BALANCE_SHEET_CATEGORY_DEFINITIONS.forEach((d) => {
  CATEGORY_TO_BALANCE_SHEET_SUBGROUP[d.name] = d.subgroup
})

const CATEGORY_TO_EXPENSE_SUBGROUP = {}
EXPENSE_CATEGORY_DEFINITIONS.forEach((d) => {
  CATEGORY_TO_EXPENSE_SUBGROUP[d.name] = d.subgroup
})

/**
 * Per-category tax metadata — single source of truth for the "Suggested
 * VAT Treatment" and "Tax Deductibility" fields shown on every
 * transaction (frontend mirrors this in categoryOptions.js). These are
 * *suggestions* grounded in the general Nigerian VAT Act and CIT rules,
 * not a substitute for professional tax advice — VAT treatment in
 * particular can depend on facts a category name alone can't capture
 * (e.g. whether specific goods sold are statutorily VAT-exempt).
 *
 * deductible: true | false | null (null = not an expense, so CIT
 * deductibility doesn't apply — income/balance-sheet/transfer lines).
 * vatTreatment: 'standard' (7.5%) | 'exempt' | 'not_applicable' (not a
 * supply of goods/services at all — wages, loans, capital, fines, tax
 * payments) | null (genuinely unknown, e.g. Uncategorised).
 */
const CATEGORY_METADATA = {
  // Income
  'Sales Revenue': { deductible: null, vatTreatment: 'standard' },
  'Service Income': { deductible: null, vatTreatment: 'standard' },
  'Rental Income': { deductible: null, vatTreatment: 'exempt' }, // lease of land/buildings is VAT-exempt
  'Foreign Exchange Gain': { deductible: null, vatTreatment: 'not_applicable' },
  'Other Income': { deductible: null, vatTreatment: 'standard' },

  // Cost of Sales
  'Cost of Goods Sold (Purchases)': { deductible: true, vatTreatment: 'standard' },
  'Direct Wages': { deductible: true, vatTreatment: 'not_applicable' },
  'Direct Expenses (incl. Carriage Inwards)': { deductible: true, vatTreatment: 'standard' },
  'Other Direct Costs': { deductible: true, vatTreatment: 'standard' },

  // Operating expenses
  'Staff Salaries & Wages': { deductible: true, vatTreatment: 'not_applicable' },
  "Directors' Remuneration": { deductible: true, vatTreatment: 'not_applicable' },
  'Staff Welfare, Gratuity & Pension': { deductible: true, vatTreatment: 'not_applicable' },
  'Rent & Utilities': { deductible: true, vatTreatment: 'exempt' },
  'Repairs, Security & Cleaning': { deductible: true, vatTreatment: 'standard' },
  'Transport, Travel & Distribution': { deductible: true, vatTreatment: 'standard' },
  'Marketing, Advertising & Promotions': { deductible: true, vatTreatment: 'standard' },
  'Professional & Audit Fees': { deductible: true, vatTreatment: 'standard' },
  'Government, Regulatory & Statutory Costs': { deductible: true, vatTreatment: 'not_applicable' },
  'Bank Charges': { deductible: true, vatTreatment: 'exempt' }, // financial services are VAT-exempt
  'Interest Expense': { deductible: true, vatTreatment: 'not_applicable' },
  'Tax Payments': { deductible: false, vatTreatment: 'not_applicable' },
  'Fines & Penalties': { deductible: false, vatTreatment: 'not_applicable' },
  'Donations': { deductible: false, vatTreatment: 'not_applicable' },
  'Corporate Social Responsibility': { deductible: false, vatTreatment: 'not_applicable' },
  'Entertainment Expenses': { deductible: false, vatTreatment: 'standard' },
  'Training & Development': { deductible: true, vatTreatment: 'standard' },
  'Office Supplies & Stationery': { deductible: true, vatTreatment: 'standard' },
  'Other Operating Expenses': { deductible: true, vatTreatment: 'standard' },

  // Non-operating
  'Foreign Exchange Loss': { deductible: true, vatTreatment: 'not_applicable' },

  // Balance Sheet — not P&L expenses, so deductibility doesn't apply
  'Capital Introduced': { deductible: null, vatTreatment: 'not_applicable' },
  'Owner/Director Withdrawal': { deductible: null, vatTreatment: 'not_applicable' },
  'Dividend Paid': { deductible: null, vatTreatment: 'not_applicable' },
  'Asset Purchase/Disposal': { deductible: null, vatTreatment: 'standard' },
  'Security Deposit Paid/Refund': { deductible: null, vatTreatment: 'not_applicable' },
  'Staff & Director Loans (Advanced/Repaid)': { deductible: null, vatTreatment: 'not_applicable' },
  'Intercompany Receivable': { deductible: null, vatTreatment: 'not_applicable' },
  'Trade Receivables Collected': { deductible: null, vatTreatment: 'not_applicable' },
  'Prepaid Expenses': { deductible: null, vatTreatment: 'not_applicable' },
  'Customer Advance / Deposit Received': { deductible: null, vatTreatment: 'not_applicable' },
  'Loan Received - Current': { deductible: null, vatTreatment: 'not_applicable' },
  'Loan Repayment - Principal (Current)': { deductible: null, vatTreatment: 'not_applicable' },
  'Intercompany Payable': { deductible: null, vatTreatment: 'not_applicable' },
  'Trade Payables Settled': { deductible: null, vatTreatment: 'not_applicable' },
  'Loan Received - Non-current': { deductible: null, vatTreatment: 'not_applicable' },
  'Loan Repayment - Principal (Non-current)': { deductible: null, vatTreatment: 'not_applicable' },

  // Transfer / Unclassified
  'Inter-account Transfer': { deductible: null, vatTreatment: 'not_applicable' },
  'Uncategorised': { deductible: null, vatTreatment: null },
}

function metadataForCategory(category) {
  return CATEGORY_METADATA[category] || { deductible: null, vatTreatment: null }
}

module.exports = {
  CATEGORY_GROUPS,
  BALANCE_SHEET_SUBGROUPS,
  EXPENSE_SUBGROUPS,
  INCOME_CATEGORIES,
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_DEFINITIONS,
  BALANCE_SHEET_CATEGORIES,
  BALANCE_SHEET_CATEGORY_DEFINITIONS,
  TRANSFER_CATEGORIES,
  UNCLASSIFIED_CATEGORIES,
  ALL_CATEGORIES,
  CATEGORY_TO_GROUP,
  CATEGORY_TO_BALANCE_SHEET_SUBGROUP,
  CATEGORY_TO_EXPENSE_SUBGROUP,
  CATEGORY_METADATA,
  metadataForCategory,
}
