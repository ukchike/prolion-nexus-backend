/**
 * VAT Calculation Utilities
 * Handles 7.5% Nigerian VAT splitting for tax-inclusive amounts
 */

const VAT_RATE = 0.075; // 7.5% Nigerian standard rate

/**
 * Split a VAT-inclusive amount into net and VAT components
 * Assumes amount includes 7.5% VAT
 * Formula: vat = amount * (7.5 / 107.5)
 *
 * @param {number} grossAmount - Total amount including VAT
 * @returns {Object} { netAmount, vatAmount }
 */
function splitVATInclusive(grossAmount) {
  const amount = parseFloat(grossAmount);

  if (isNaN(amount) || amount < 0) {
    throw new Error('Invalid amount for VAT calculation');
  }

  // VAT = Gross * (7.5 / 107.5) = Gross * 0.069767...
  const vatAmount = amount * (VAT_RATE / (1 + VAT_RATE));
  const netAmount = amount - vatAmount;

  return {
    netAmount: parseFloat(netAmount.toFixed(2)),
    vatAmount: parseFloat(vatAmount.toFixed(2)),
    grossAmount: amount,
  };
}

/**
 * Calculate VAT on a net amount (for informational display)
 *
 * @param {number} netAmount - Amount before VAT
 * @returns {Object} { netAmount, vatAmount, grossAmount }
 */
function calculateVATOnNet(netAmount) {
  const net = parseFloat(netAmount);

  if (isNaN(net) || net < 0) {
    throw new Error('Invalid net amount for VAT calculation');
  }

  const vatAmount = net * VAT_RATE;
  const grossAmount = net + vatAmount;

  return {
    netAmount: net,
    vatAmount: parseFloat(vatAmount.toFixed(2)),
    grossAmount: parseFloat(grossAmount.toFixed(2)),
  };
}

/**
 * Validate VAT amount is reasonable for given gross
 *
 * @param {number} grossAmount - Total amount
 * @param {number} vatAmount - VAT component
 * @returns {boolean}
 */
function isValidVATAmount(grossAmount, vatAmount) {
  const gross = parseFloat(grossAmount);
  const vat = parseFloat(vatAmount);

  if (isNaN(gross) || isNaN(vat) || gross <= 0 || vat < 0) {
    return false;
  }

  // VAT should not exceed ~6.98% of gross (accounting for rounding)
  const maxValidVAT = gross * (VAT_RATE / (1 + VAT_RATE)) * 1.01; // +1% tolerance
  return vat <= maxValidVAT;
}

/**
 * Format VAT display with breakdown
 *
 * @param {number} grossAmount - Total amount
 * @param {number} netAmount - Net amount
 * @param {string} currency - Currency symbol (default ₦)
 * @returns {string} Formatted display string
 */
function formatVATBreakdown(grossAmount, netAmount, currency = '₦') {
  const vatAmount = parseFloat(grossAmount) - parseFloat(netAmount);
  return `${currency}${netAmount.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} + ${currency}${vatAmount.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} VAT`;
}

module.exports = {
  VAT_RATE,
  splitVATInclusive,
  calculateVATOnNet,
  isValidVATAmount,
  formatVATBreakdown,
};
