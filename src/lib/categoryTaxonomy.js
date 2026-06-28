/**
 * Category taxonomy for NEXUS.
 * Defined once here in Sprint 1 because parsers tag a provisional
 * category_group (INCOME / EXPENSE / TRANSFER / UNCLASSIFIED) based on
 * debit/credit direction. The detailed AI categorisation (Sprint 2) will
 * assign the specific category within these groups.
 *
 * Revised after reviewing a real Nigerian SME Chart of Accounts
 * framework (supplied by the user): three categories were reclassified
 * from P&L into Balance Sheet, since they were technically misplaced —
 * see the comments above BALANCE_SHEET_CATEGORIES for the reasoning.
 * If this categorisation ever feeds a real FIRS computation, getting
 * these placements right matters for more than just labelling.
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
  'Other Income',
  // NOTE: 'Loan Received' deliberately NOT here — a loan is a liability
  // increase, not revenue. See BALANCE_SHEET_CATEGORIES.
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
  // here — repaying loan principal reduces a liability (not a cost),
  // and an owner/director drawing is an equity movement, not a
  // deductible expense. Both moved to BALANCE_SHEET_CATEGORIES.
  // 'Interest Expense' is new — it's the genuinely P&L-relevant part
  // of a loan repayment, now split out so it has somewhere correct to go.
]

// Expanded from 3 to 12 items after user feedback that this group was
// too thin relative to Income/Expense. Reclassifications from P&L:
// Loan Received (was Income), Loan Repayment Principal + Owner
// Withdrawal (were Expense) — see notes above. New additions cover
// asset, liability, and equity-side movements that can plausibly show
// up as a single bank transaction line (deliberately excludes non-cash
// period-end entries like depreciation, which never appear on a
// statement).
const BALANCE_SHEET_CATEGORIES = [
  'Capital Introduced',
  'Owner/Director Withdrawal',
  'Asset Purchase',
  'Asset Disposal Proceeds',
  'Loan Received',
  'Loan Repayment - Principal',
  'Security Deposit Paid',
  'Security Deposit Refund',
  'Customer Advance / Deposit Received',
  'Staff Loan Advanced',
  'Staff Loan Repayment Received',
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
