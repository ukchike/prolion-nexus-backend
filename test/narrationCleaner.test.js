/**
 * Narration Cleaner Tests
 */

const { cleanNarration, batchCleanNarrations, extractMerchantName } = require('../src/lib/narrationCleaner');

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

// Test Cases
test('removes Nigerian bank routing codes', () => {
  const input = 'TRANSFER TRF/FRM/123456 from John Doe';
  const output = cleanNarration(input);
  assert(!output.includes('TRF'), `Expected TRF to be removed, got: ${output}`);
  assert(output.includes('John Doe'), 'Expected John Doe to remain');
});

test('removes transaction IDs', () => {
  const input = 'Payment REF123456789 for services rendered';
  const output = cleanNarration(input);
  assert(!output.includes('REF'), 'Expected REF to be removed');
  assert(output.includes('services'), 'Expected key words to remain');
});

test('removes NIP codes', () => {
  const input = 'NIP/STAN123456 transfer of funds to customer account John Doe';
  const output = cleanNarration(input);
  assert(!output.includes('NIP'), `Expected NIP to be removed, got: ${output}`);
  assert(output.includes('transfer'), `Expected transfer to remain, got: ${output}`);
});

test('removes POSX references', () => {
  const input = 'POSX/STAN123456 - POS payment at store';
  const output = cleanNarration(input);
  assert(!output.includes('POSX'), `Expected POSX to be removed, got: ${output}`);
  assert(output.includes('POS payment'), 'Expected POS payment to remain');
});

test('normalizes multiple spaces', () => {
  const input = 'Payment   for   office   supplies';
  const output = cleanNarration(input);
  assert(!output.includes('   '), 'Expected multiple spaces to be normalized');
});

test('removes boundary special characters', () => {
  const input = '***Payment for invoice***';
  const output = cleanNarration(input);
  assert(!output.startsWith('*'), 'Expected leading * to be removed');
  assert(!output.endsWith('*'), 'Expected trailing * to be removed');
});

test('preserves meaningful content', () => {
  const input = 'Staff salary payment for January month';
  const output = cleanNarration(input);
  assert(output.includes('salary'), 'Expected salary to remain');
  assert(output.includes('payment'), 'Expected payment to remain');
  assert(output.includes('January'), 'Expected month name to remain');
});

test('returns original if result is too short', () => {
  const input = 'A/C';
  const output = cleanNarration(input);
  assert(output === input, `Expected original to be returned, got: ${output}`);
});

test('handles empty string', () => {
  const output = cleanNarration('');
  assert(output === '', `Expected empty string, got: ${output}`);
});

test('handles null', () => {
  const output = cleanNarration(null);
  assert(output === '', `Expected empty string for null, got: ${output}`);
});

test('batch clean narrations', () => {
  const inputs = [
    'TRF/FRM/123456 Payment from vendor',
    'REF123456 Invoice #001',
    'NIP transfer complete',
  ];
  const result = batchCleanNarrations(inputs);
  assert(Array.isArray(result.cleaned), 'Expected cleaned array');
  assert(Array.isArray(result.original), 'Expected original array');
  assert(result.cleaned.length === 3, 'Expected 3 cleaned items');
  assert(!result.cleaned[0].includes('TRF'), 'Expected TRF to be removed in batch');
});

test('removes very long serial numbers', () => {
  const input = 'Transaction ABC123DEF456GHI789JKL012XYZ345ABCDEFGHIJKLMNOPQRS processed';
  const output = cleanNarration(input);
  assert(output.includes('processed'), `Expected 'processed' to remain, got: ${output}`);
});

test('handles trace numbers', () => {
  const input = 'TRACE123456 RRN987654 settlement complete';
  const output = cleanNarration(input);
  assert(!output.includes('TRACE'), 'Expected TRACE to be removed');
  assert(!output.includes('RRN'), 'Expected RRN to be removed');
  assert(output.includes('settlement'), 'Expected settlement to remain');
});

test('extracts a probable merchant name, stripping flow words', () => {
  const cleaned = cleanNarration('TRANSFER FROM DANGOTE AGRO LIMITED');
  const merchant = extractMerchantName(cleaned);
  assert(merchant && merchant.toUpperCase().includes('DANGOTE AGRO LIMITED'), `Expected merchant to include DANGOTE AGRO LIMITED, got: ${merchant}`);
});

test('merchant extraction picks the longest alphabetic run, not a short leftover word', () => {
  const cleaned = cleanNarration('POS PURCHASE SHOPRITE IKEJA LAGOS VALUE 15000');
  const merchant = extractMerchantName(cleaned);
  assert(merchant && merchant.toUpperCase().includes('SHOPRITE'), `Expected merchant to include SHOPRITE, got: ${merchant}`);
});

test('merchant extraction returns null for a narration with no alphabetic run', () => {
  assert(extractMerchantName('123456 7890') === null, 'Expected null for a purely numeric narration');
});

test('merchant extraction returns null for empty/short input', () => {
  assert(extractMerchantName('') === null, 'Expected null for empty string');
  assert(extractMerchantName(null) === null, 'Expected null for null');
});

console.log('\n✅ Narration Cleaner Tests Complete\n');
