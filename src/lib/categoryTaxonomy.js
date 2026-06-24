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

module.exports = {
  CATEGORY_GROUPS,
  INCOME_CATEGORIES,
  EXPENSE_CATEGORIES,
  BALANCE_SHEET_CATEGORIES,
}
