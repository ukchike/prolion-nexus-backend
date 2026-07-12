/**
 * VAT Calculator Tests
 */

const {
  VAT_RATE,
  splitVATInclusive,
  calculateVATOnNet,
  isValidVATAmount,
  formatVATBreakdown,
} = require('../src/lib/vatCalculator');

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

function assertAlmostEqual(actual, expected, tolerance = 0.01, message = '') {
  const diff = Math.abs(actual - expected);
  if (diff > tolerance) {
    throw new Error(`Expected ${expected} ± ${tolerance}, got ${actual}. ${message}`);
  }
}

// Test VAT_RATE
test('VAT_RATE is 7.5%', () => {
  assertAlmostEqual(VAT_RATE, 0.075);
});

// Test splitVATInclusive
test('split 107.5 into 100 net and 7.5 VAT', () => {
  const result = splitVATInclusive(107.5);
  assertAlmostEqual(result.netAmount, 100, 0.01);
  assertAlmostEqual(result.vatAmount, 7.5, 0.01);
  assertAlmostEqual(result.grossAmount, 107.5, 0.01);
});

test('split 1000 correctly', () => {
  const result = splitVATInclusive(1000);
  // Net should be: 1000 * (1 / 1.075) = 930.23
  // VAT should be: 1000 - 930.23 = 69.77
  assertAlmostEqual(result.netAmount + result.vatAmount, 1000, 0.01);
  assertAlmostEqual(result.vatAmount / result.netAmount, VAT_RATE, 0.001);
});

test('split 50000 for Nigerian context', () => {
  const result = splitVATInclusive(50000);
  const expectedNet = 50000 / 1.075;
  assertAlmostEqual(result.netAmount, expectedNet, 0.01);
  const expectedVAT = 50000 - expectedNet;
  assertAlmostEqual(result.vatAmount, expectedVAT, 0.01);
});

test('throws on negative amount', () => {
  try {
    splitVATInclusive(-100);
    throw new Error('Expected error on negative amount');
  } catch (e) {
    assert(e.message.includes('Invalid'), `Expected validation error, got: ${e.message}`);
  }
});

test('throws on NaN', () => {
  try {
    splitVATInclusive('not a number');
    throw new Error('Expected error on NaN');
  } catch (e) {
    assert(e.message.includes('Invalid'), `Expected validation error`);
  }
});

// Test calculateVATOnNet
test('calculate VAT on 1000 net', () => {
  const result = calculateVATOnNet(1000);
  assertAlmostEqual(result.netAmount, 1000);
  assertAlmostEqual(result.vatAmount, 75, 0.01); // 1000 * 0.075
  assertAlmostEqual(result.grossAmount, 1075, 0.01);
});

test('calculate VAT on zero', () => {
  const result = calculateVATOnNet(0);
  assertAlmostEqual(result.netAmount, 0);
  assertAlmostEqual(result.vatAmount, 0);
  assertAlmostEqual(result.grossAmount, 0);
});

// Test isValidVATAmount
test('validates correct VAT amount', () => {
  const result = splitVATInclusive(1000);
  assert(isValidVATAmount(1000, result.vatAmount), 'Valid VAT amount should pass');
});

test('rejects VAT amount exceeding gross', () => {
  assert(!isValidVATAmount(100, 200), 'VAT cannot exceed gross');
});

test('rejects negative VAT', () => {
  assert(!isValidVATAmount(100, -10), 'VAT cannot be negative');
});

test('rejects invalid inputs', () => {
  assert(!isValidVATAmount('abc', 10), 'Non-numeric inputs should fail');
  assert(!isValidVATAmount(100, 'xyz'), 'Non-numeric VAT should fail');
  assert(!isValidVATAmount(-50, 10), 'Negative gross should fail');
});

// Test formatVATBreakdown
test('format VAT breakdown for display', () => {
  const result = formatVATBreakdown(1075, 1000, '₦');
  assert(result.includes('1,000'), `Expected formatted net, got: ${result}`);
  assert(result.includes('75'), `Expected VAT amount, got: ${result}`);
  assert(result.includes('VAT'), `Expected VAT label, got: ${result}`);
});

test('format with different currency', () => {
  const result = formatVATBreakdown(107.5, 100, '$');
  assert(result.startsWith('$'), 'Expected $ currency');
});

test('format large Nigerian amount', () => {
  const result = formatVATBreakdown(50000, 46511.63, '₦');
  assert(result.includes('46,511.63'), `Expected formatted net, got: ${result}`);
  assert(result.includes('VAT'), 'Expected VAT label');
});

// Realistic Nigerian transaction scenarios
test('real scenario: ₦50,000 invoice with VAT', () => {
  const invoice = 50000;
  const result = splitVATInclusive(invoice);
  console.log(`  Invoice: ₦${invoice.toLocaleString()}`);
  console.log(`  Net: ₦${result.netAmount.toLocaleString()}`);
  console.log(`  VAT: ₦${result.vatAmount.toLocaleString()}`);
  assert(result.netAmount > 0, 'Net must be positive');
  assert(result.vatAmount > 0, 'VAT must be positive');
  assert(Math.abs((result.netAmount + result.vatAmount) - invoice) < 0.01, 'Should sum to invoice');
});

test('round-trip consistency', () => {
  const gross = 12345.67;
  const split = splitVATInclusive(gross);
  const roundTrip = split.netAmount + split.vatAmount;
  assertAlmostEqual(roundTrip, gross, 0.01, 'Round-trip should return original amount');
});

console.log('\n✅ VAT Calculator Tests Complete\n');
