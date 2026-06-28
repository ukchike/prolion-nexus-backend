/**
 * Category taxonomy for NEXUS.
 * Defined once here in Sprint 1 because parsers tag a provisional
 * category_group (INCOME / EXPENSE / TRANSFER / UNCLASSIFIED) based on
 * debit/credit direction. The detailed AI categorisation (Sprint 2) will
 * assign the specific category within these groups.
 *
 * Balance Sheet categories are further sub-classified into the standard
 * IFRS-for-SMEs structure (Non-current Assets / Current Assets / Current
 * Liabilities / Non-current Liabilities / Equity) — a flat "Balance
 * Sheet" bucket isn't enough to actually present or analyse a balance
 * sheet (current ratio, etc. all depend on this split). This subgroup is
 * derived from category name via lookup, not stored as its own database
 * column — it's a static 1:1 mapping, so no schema migration needed for
 * this; revisit only if Sprint 3 needs it persisted for query reasons.
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

const INCOME_CATEGORIES = [
  'Sales Revenue',
  'Service Income',
  'Rental Income',
  'Other Income',
  // NOTE: 'Loan Received' deliberately NOT here — a loan is a liability
  // increase, not revenue. See BALANCE_SHEET_CATEGORY_DEFINITIONS.
]

const EXPENSE_CATEGORIES = [
  'Cost of Goods Sold',
  'Staff Salaries & Wages',
  'Rent & Utilities',
  'Bank Charges',
  'Transport & Logistics',
  'Marketing & Advertising',
  'Professional Fees',
  'Tax Payments',
  'Interest Expense',
  'Other Operating Expenses',
  // NOTE: 'Loan Repayment' and 'Personal Withdrawal' deliberately NOT
  // here — see BALANCE_SHEET_CATEGORY_DEFINITIONS below.
]

/**
 * Each Balance Sheet category carries its IFRS-for-SMEs subgroup
 * directly, so there's exactly one place to look when deciding where a
 * category belongs — no separate parallel list to keep in sync.
 *
 * Loan categories are split Current/Non-current because that's a real,
 * necessary distinction for balance sheet presentation, even though a
 * bank transaction description rarely states the loan term explicitly.
 * The AI is guided (see categorisationEngine.js buildPrompt) to default
 * to Current when the term isn't indicated, since that's the more
 * common case for informal SME lending — but this is exactly the kind
 * of thing worth checking in the Review screen, not trusting blindly.
 *
 * Security Deposit Paid/Refund are paired under the SAME subgroup
 * (Non-current Assets) deliberately — they're opposite movements of one
 * balance sheet line, not two unrelated categories.
 */
const BALANCE_SHEET_CATEGORY_DEFINITIONS = [
  { name: 'Capital Introduced', subgroup: BALANCE_SHEET_SUBGROUPS.EQUITY },
  { name: 'Owner/Director Withdrawal', subgroup: BALANCE_SHEET_SUBGROUPS.EQUITY },

  { name: 'Asset Purchase', subgroup: BALANCE_SHEET_SUBGROUPS.NON_CURRENT_ASSETS },
  { name: 'Asset Disposal Proceeds', subgroup: BALANCE_SHEET_SUBGROUPS.NON_CURRENT_ASSETS },
  { name: 'Security Deposit Paid', subgroup: BALANCE_SHEET_SUBGROUPS.NON_CURRENT_ASSETS },
  { name: 'Security Deposit Refund', subgroup: BALANCE_SHEET_SUBGROUPS.NON_CURRENT_ASSETS },

  { name: 'Staff Loan Advanced', subgroup: BALANCE_SHEET_SUBGROUPS.CURRENT_ASSETS },
  { name: 'Staff Loan Repayment Received', subgroup: BALANCE_SHEET_SUBGROUPS.CURRENT_ASSETS },
  { name: 'Intercompany Receivable', subgroup: BALANCE_SHEET_SUBGROUPS.CURRENT_ASSETS },

  { name: 'Customer Advance / Deposit Received', subgroup: BALANCE_SHEET_SUBGROUPS.CURRENT_LIABILITIES },
  { name: 'Loan Received - Current', subgroup: BALANCE_SHEET_SUBGROUPS.CURRENT_LIABILITIES },
  { name: 'Loan Repayment - Principal (Current)', subgroup: BALANCE_SHEET_SUBGROUPS.CURRENT_LIABILITIES },
  { name: 'Intercompany Payable', subgroup: BALANCE_SHEET_SUBGROUPS.CURRENT_LIABILITIES },

  { name: 'Loan Received - Non-current', subgroup: BALANCE_SHEET_SUBGROUPS.NON_CURRENT_LIABILITIES },
  { name: 'Loan Repayment - Principal (Non-current)', subgroup: BALANCE_SHEET_SUBGROUPS.NON_CURRENT_LIABILITIES },
]

const BALANCE_SHEET_CATEGORIES = BALANCE_SHEET_CATEGORY_DEFINITIONS.map((d) => d.name)

const TRANSFER_CATEGORIES = ['Inter-account Transfer']

// Deliberately small — this is a last-resort fallback for genuinely
// ambiguous transactions, not a category to lean on. If the AI
// categoriser is using this often, the prompt or category list needs
// work, not this list.
const UNCLASSIFIED_CATEGORIES = ['Uncategorised']

const ALL_CATEGORIES = [
  ...INCOME_CATEGORIES,
  ...EXPENSE_CATEGORIES,
  ...BALANCE_SHEET_CATEGORIES,
  ...TRANSFER_CATEGORIES,
  ...UNCLASSIFIED_CATEGORIES,
]

// Reverse lookup: given a specific category name, what group does it
// belong to? Built once here rather than asked of the AI per-transaction,
// so category_group can never be inconsistent with category.
const CATEGORY_TO_GROUP = {}
INCOME_CATEGORIES.forEach((c) => (CATEGORY_TO_GROUP[c] = CATEGORY_GROUPS.INCOME))
EXPENSE_CATEGORIES.forEach((c) => (CATEGORY_TO_GROUP[c] = CATEGORY_GROUPS.EXPENSE))
BALANCE_SHEET_CATEGORIES.forEach((c) => (CATEGORY_TO_GROUP[c] = CATEGORY_GROUPS.BALANCE_SHEET))
TRANSFER_CATEGORIES.forEach((c) => (CATEGORY_TO_GROUP[c] = CATEGORY_GROUPS.TRANSFER))
UNCLASSIFIED_CATEGORIES.forEach((c) => (CATEGORY_TO_GROUP[c] = CATEGORY_GROUPS.UNCLASSIFIED))

// Reverse lookup: given a Balance Sheet category name, which of the 5
// IFRS-for-SMEs subgroups does it belong to? Undefined for any
// non-Balance-Sheet category (Income/Expense/Transfer/Unclassified
// don't have a subgroup, by definition).
const CATEGORY_TO_BALANCE_SHEET_SUBGROUP = {}
BALANCE_SHEET_CATEGORY_DEFINITIONS.forEach((d) => {
  CATEGORY_TO_BALANCE_SHEET_SUBGROUP[d.name] = d.subgroup
})

module.exports = {
  CATEGORY_GROUPS,
  BALANCE_SHEET_SUBGROUPS,
  INCOME_CATEGORIES,
  EXPENSE_CATEGORIES,
  BALANCE_SHEET_CATEGORIES,
  BALANCE_SHEET_CATEGORY_DEFINITIONS,
  TRANSFER_CATEGORIES,
  UNCLASSIFIED_CATEGORIES,
  ALL_CATEGORIES,
  CATEGORY_TO_GROUP,
  CATEGORY_TO_BALANCE_SHEET_SUBGROUP,
}
