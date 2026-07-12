/**
 * Zod Validation Schemas
 * Input validation for all API endpoints
 */

const { z } = require('zod');

// Category validation against NEXUS taxonomy
const VALID_CATEGORIES = [
  // Income (4)
  'Sales Revenue',
  'Service Income',
  'Investment Income',
  'Other Income',

  // Cost of Sales (4)
  'Cost of Goods Sold',
  'Materials & Supplies',
  'Direct Labour',
  'Manufacturing Overhead',

  // Operating Expenses (20)
  'Salaries & Wages',
  'Rent & Utilities',
  'Office Supplies',
  'Transportation',
  'Meals & Entertainment',
  'Advertising & Marketing',
  'Professional Services',
  'Insurance',
  'Repairs & Maintenance',
  'Depreciation',
  'Phone & Internet',
  'Travel',
  'Training & Development',
  'Subscriptions & Software',
  'Bank Charges & Fees',
  'Interest Expense',
  'Donations & CSR',
  'Fines & Penalties',
  'Miscellaneous Expense',
  'Owner Drawings',

  // Balance Sheet (16)
  'Cash at Bank',
  'Cash on Hand',
  'Accounts Receivable',
  'Inventory',
  'Prepaid Expenses',
  'Fixed Assets',
  'Accumulated Depreciation',
  'Intangible Assets',
  'Accounts Payable',
  'Tax Payable',
  'Loans Payable',
  'Accrued Expenses',
  'Owner Equity',
  'Retained Earnings',
  'Capital Contribution',
  'Loans Receivable',

  // Special
  'Transfer',
  'Unclassified',
];

const TRANSACTION_TYPES = ['income', 'expense', 'asset', 'liability', 'equity', 'transfer'];

// Manual Transaction Input Schema
const ManualTransactionSchema = z.object({
  date: z.string().refine(
    (val) => !isNaN(Date.parse(val)),
    'Invalid date format (use ISO 8601)',
  ),
  narration: z
    .string()
    .min(3, 'Description must be at least 3 characters')
    .max(500, 'Description cannot exceed 500 characters'),
  amount: z
    .number()
    .positive('Amount must be greater than 0'),
  type: z.enum(TRANSACTION_TYPES, {
    errorMap: () => ({ message: `Type must be one of: ${TRANSACTION_TYPES.join(', ')}` }),
  }),
  category: z
    .string()
    .refine(
      (val) => VALID_CATEGORIES.includes(val),
      `Category must be one of the valid taxonomy categories`,
    ),
  is_vat_inclusive: z.boolean().default(false),
  notes: z.string().max(1000, 'Notes cannot exceed 1000 characters').optional(),
});

// VAT Toggle Schema
const VATToggleSchema = z.object({
  is_vat_inclusive: z.boolean(),
});

// Opening Balances Input Schema
const OpeningBalancesSchema = z.object({
  start_date: z.string().refine(
    (val) => !isNaN(Date.parse(val)),
    'Invalid date format (use ISO 8601)',
  ).optional(),
  assets: z.object({
    cash_at_bank: z.number().nonnegative().default(0),
    fixed_assets: z.number().nonnegative().default(0),
    inventory: z.number().nonnegative().default(0),
    other_assets: z.number().nonnegative().default(0),
  }).optional(),
  liabilities: z.object({
    bank_loans: z.number().nonnegative().default(0),
    other_payables: z.number().nonnegative().default(0),
  }).optional(),
  equity: z.object({
    retained_earnings: z.number().nonnegative().default(0),
    owner_capital: z.number().nonnegative().default(0),
  }).optional(),
});

// Dashboard Aggregation Query Schema
const DashboardQuerySchema = z.object({
  start_date: z.string().refine(
    (val) => !isNaN(Date.parse(val)),
    'Invalid date format (use ISO 8601)',
  ).optional(),
  end_date: z.string().refine(
    (val) => !isNaN(Date.parse(val)),
    'Invalid date format (use ISO 8601)',
  ).optional(),
});

/**
 * Validate and parse input
 * @param {Object} schema - Zod schema
 * @param {Object} data - Data to validate
 * @returns {Object} { success: boolean, data?: Object, error?: string }
 */
function validateInput(schema, data) {
  try {
    const validated = schema.parse(data);
    return { success: true, data: validated };
  } catch (error) {
    const messages = error.errors?.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ') || error.message;
    return { success: false, error: messages };
  }
}

module.exports = {
  ManualTransactionSchema,
  VATToggleSchema,
  OpeningBalancesSchema,
  DashboardQuerySchema,
  validateInput,
  VALID_CATEGORIES,
  TRANSACTION_TYPES,
};
