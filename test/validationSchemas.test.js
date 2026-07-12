/**
 * Validation Schema Tests
 */

const {
  ManualTransactionSchema,
  VATToggleSchema,
  OpeningBalancesSchema,
  validateInput,
} = require('../src/lib/validationSchemas');

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}`);
    console.error(`  ${error.message}`);
    process.exitCode = 1;
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

// Manual Transaction Validation Tests
test('accepts valid manual transaction', () => {
  const input = {
    date: '2024-07-12',
    narration: 'Office supplies purchase',
    amount: 5000,
    type: 'expense',
    category: 'Office Supplies',
    is_vat_inclusive: false,
  };
  const result = validateInput(ManualTransactionSchema, input);
  assert(result.success, `Expected success, got error: ${result.error}`);
  assert(result.data.amount === 5000, 'Amount should be preserved');
});

test('accepts manual transaction with VAT', () => {
  const input = {
    date: '2024-07-12',
    narration: 'Sales invoice #001',
    amount: 10750, // Includes 7.5% VAT
    type: 'income',
    category: 'Sales Revenue',
    is_vat_inclusive: true,
  };
  const result = validateInput(ManualTransactionSchema, input);
  assert(result.success, `Expected success, got: ${result.error}`);
  assert(result.data.is_vat_inclusive === true, 'VAT flag should be preserved');
});

test('accepts manual transaction with optional notes', () => {
  const input = {
    date: '2024-07-12',
    narration: 'Monthly retainer payment',
    amount: 50000,
    type: 'expense',
    category: 'Professional Services',
    is_vat_inclusive: true,
    notes: 'Monthly consulting agreement',
  };
  const result = validateInput(ManualTransactionSchema, input);
  assert(result.success, `Expected success, got: ${result.error}`);
});

test('rejects transaction with missing date', () => {
  const input = {
    narration: 'Invalid transaction',
    amount: 1000,
    type: 'expense',
    category: 'Office Supplies',
  };
  const result = validateInput(ManualTransactionSchema, input);
  assert(!result.success, 'Should reject missing date');
});

test('rejects transaction with invalid date', () => {
  const input = {
    date: 'not-a-date',
    narration: 'Invalid date transaction',
    amount: 1000,
    type: 'expense',
    category: 'Office Supplies',
  };
  const result = validateInput(ManualTransactionSchema, input);
  assert(!result.success, 'Should reject invalid date');
});

test('rejects transaction with negative amount', () => {
  const input = {
    date: '2024-07-12',
    narration: 'Negative amount',
    amount: -1000,
    type: 'expense',
    category: 'Office Supplies',
  };
  const result = validateInput(ManualTransactionSchema, input);
  assert(!result.success, 'Should reject negative amount');
});

test('rejects transaction with zero amount', () => {
  const input = {
    date: '2024-07-12',
    narration: 'Zero amount',
    amount: 0,
    type: 'expense',
    category: 'Office Supplies',
  };
  const result = validateInput(ManualTransactionSchema, input);
  assert(!result.success, 'Should reject zero amount');
});

test('rejects invalid transaction type', () => {
  const input = {
    date: '2024-07-12',
    narration: 'Invalid type',
    amount: 1000,
    type: 'invalid_type',
    category: 'Office Supplies',
  };
  const result = validateInput(ManualTransactionSchema, input);
  assert(!result.success, 'Should reject invalid type');
});

test('rejects invalid category', () => {
  const input = {
    date: '2024-07-12',
    narration: 'Invalid category',
    amount: 1000,
    type: 'expense',
    category: 'NonexistentCategory',
  };
  const result = validateInput(ManualTransactionSchema, input);
  assert(!result.success, 'Should reject invalid category');
});

test('rejects narration too short', () => {
  const input = {
    date: '2024-07-12',
    narration: 'AB',
    amount: 1000,
    type: 'expense',
    category: 'Office Supplies',
  };
  const result = validateInput(ManualTransactionSchema, input);
  assert(!result.success, 'Should reject too-short narration');
});

test('rejects narration too long', () => {
  const input = {
    date: '2024-07-12',
    narration: 'A'.repeat(501),
    amount: 1000,
    type: 'expense',
    category: 'Office Supplies',
  };
  const result = validateInput(ManualTransactionSchema, input);
  assert(!result.success, 'Should reject too-long narration');
});

// VAT Toggle Validation Tests
test('accepts valid VAT toggle true', () => {
  const input = { is_vat_inclusive: true };
  const result = validateInput(VATToggleSchema, input);
  assert(result.success, `Expected success, got: ${result.error}`);
});

test('accepts valid VAT toggle false', () => {
  const input = { is_vat_inclusive: false };
  const result = validateInput(VATToggleSchema, input);
  assert(result.success, `Expected success, got: ${result.error}`);
});

test('rejects non-boolean VAT toggle', () => {
  const input = { is_vat_inclusive: 'yes' };
  const result = validateInput(VATToggleSchema, input);
  assert(!result.success, 'Should reject non-boolean value');
});

// Opening Balances Validation Tests
test('accepts valid opening balances with all fields', () => {
  const input = {
    start_date: '2024-01-01',
    assets: {
      cash_at_bank: 500000,
      fixed_assets: 1000000,
      inventory: 200000,
      other_assets: 50000,
    },
    liabilities: {
      bank_loans: 250000,
      other_payables: 50000,
    },
    equity: {
      retained_earnings: 0,
      owner_capital: 1450000,
    },
  };
  const result = validateInput(OpeningBalancesSchema, input);
  assert(result.success, `Expected success, got: ${result.error}`);
});

test('accepts opening balances with minimal data', () => {
  const input = {};
  const result = validateInput(OpeningBalancesSchema, input);
  assert(result.success, `Expected success, got: ${result.error}`);
});

test('rejects negative opening balance amounts', () => {
  const input = {
    assets: {
      cash_at_bank: -100,
    },
  };
  const result = validateInput(OpeningBalancesSchema, input);
  assert(!result.success, 'Should reject negative amounts');
});

test('rejects invalid date in opening balances', () => {
  const input = {
    start_date: 'invalid-date',
  };
  const result = validateInput(OpeningBalancesSchema, input);
  assert(!result.success, 'Should reject invalid date');
});

// All valid income categories
const incomeCategories = ['Sales Revenue', 'Service Income', 'Investment Income', 'Other Income'];
test('accepts all income categories', () => {
  incomeCategories.forEach((cat) => {
    const input = {
      date: '2024-07-12',
      narration: 'Income transaction',
      amount: 1000,
      type: 'income',
      category: cat,
    };
    const result = validateInput(ManualTransactionSchema, input);
    assert(result.success, `Should accept category: ${cat}`);
  });
});

console.log('\n✅ Validation Schema Tests Complete\n');
