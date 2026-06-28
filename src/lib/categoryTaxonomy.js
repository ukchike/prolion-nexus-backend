/**
 * Category taxonomy for NEXUS.
 * Defined once here in Sprint 1 because parsers tag a provisional
 * category_group (INCOME / EXPENSE / TRANSFER / UNCLASSIFIED) based on
 * debit/credit direction. The detailed AI categorisation (Sprint 2) will
 * assign the specific category within these groups.
 */

const CATEGORY_GROUPS = {
  INCOME: 'INCOME',
  EXPENSE: 'EXPENSE',
  BALANCE_SHEET: 'BALANCE_SHEET',
  TRANSFER: 'TRANSFER',
  UNCLASSIFIED: 'UNCLASSIFIED',
}

const INCOME_CATEGORIES = [
  'Sales Revenue',
  'Service Income',
  'Rental Income',
  'Loan Received',
  'Other Income',
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
  'Loan Repayment',
  'Personal Withdrawal',
  'Other Operating Expenses',
]

const BALANCE_SHEET_CATEGORIES = [
  'Capital Introduced',
  'Asset Purchase',
  'Intercompany Transfer',
]

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
// so category_group can never be inconsistent with category (e.g. the AI
// picking "Sales Revenue" but mistakenly tagging it EXPENSE) — group is
// always derived deterministically from the chosen category.
const CATEGORY_TO_GROUP = {}
INCOME_CATEGORIES.forEach((c) => (CATEGORY_TO_GROUP[c] = CATEGORY_GROUPS.INCOME))
EXPENSE_CATEGORIES.forEach((c) => (CATEGORY_TO_GROUP[c] = CATEGORY_GROUPS.EXPENSE))
BALANCE_SHEET_CATEGORIES.forEach((c) => (CATEGORY_TO_GROUP[c] = CATEGORY_GROUPS.BALANCE_SHEET))
TRANSFER_CATEGORIES.forEach((c) => (CATEGORY_TO_GROUP[c] = CATEGORY_GROUPS.TRANSFER))
UNCLASSIFIED_CATEGORIES.forEach((c) => (CATEGORY_TO_GROUP[c] = CATEGORY_GROUPS.UNCLASSIFIED))

module.exports = {
  CATEGORY_GROUPS,
  INCOME_CATEGORIES,
  EXPENSE_CATEGORIES,
  BALANCE_SHEET_CATEGORIES,
  TRANSFER_CATEGORIES,
  UNCLASSIFIED_CATEGORIES,
  ALL_CATEGORIES,
  CATEGORY_TO_GROUP,
}
