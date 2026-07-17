/**
 * Narration Pre-Cleaning Filter
 * Strips transaction IDs, reference codes, routing codes, and excess punctuation
 * to improve AI categorization accuracy and reduce token usage.
 * Preserves original for audit trail.
 */

const PATTERNS = {
  // Transaction reference patterns: REF/TXN/etc + 6+ alphanumeric
  transactionRefs: /(REF|TRAN|TXN|REQ|PNR|CONF|AUTH|CRN)\d+/gi,

  // Trace codes: TRACE/STAN + 6+ digits, or RRN alone
  traceNumbers: /(TRACE|STAN)\d{6,}|(RRN[\d\w]+)/gi,

  // Nigerian bank routing codes (TRF/FROM/TO, FT+digits, NIP, POSX, IPPIS, etc.)
  bankRoutingCodes: /\b(TRF\/\w+|FT\d+|NIP|POSX|IPPIS|NTSA|RTR|OPS|SWIFT|NEFT|RTGS|IMPS)\b/gi,

  // Multiple spaces/punctuation
  excessPunctuation: /[;:,]{2,}|[\s]{2,}/g,

  // Leading/trailing special chars
  boundarySpecial: /^[\W_]+|[\W_]+$/g,
};

/**
 * Clean narration by removing transaction noise
 * @param {string} rawNarration - Original transaction description
 * @returns {string} Cleaned narration suitable for AI categorization
 */
function cleanNarration(rawNarration) {
  if (!rawNarration || typeof rawNarration !== 'string') {
    return '';
  }

  let cleaned = rawNarration.trim();

  // Remove trace/RRN numbers (TRACE, STAN, RRN with optional digits)
  cleaned = cleaned.replace(PATTERNS.traceNumbers, '');

  // Remove Nigerian bank routing codes (TRF, FT, NIP, POSX, etc.)
  cleaned = cleaned.replace(PATTERNS.bankRoutingCodes, '');

  // Remove transaction reference patterns (REF, TRAN, etc.)
  cleaned = cleaned.replace(PATTERNS.transactionRefs, '');

  // Remove long serial numbers (25+ alphanumeric - be conservative)
  cleaned = cleaned.replace(/\b[A-Z0-9]{25,}\b/g, '');

  // Normalize multiple spaces and punctuation
  cleaned = cleaned.replace(PATTERNS.excessPunctuation, ' ');

  // Remove boundary special characters
  cleaned = cleaned.replace(PATTERNS.boundarySpecial, '');

  // Trim again
  cleaned = cleaned.trim();

  // If result is empty or very short, return original
  if (cleaned.length < 3) {
    return rawNarration.trim();
  }

  return cleaned;
}

/**
 * Batch clean multiple narrations
 * @param {string[]} narrations - Array of transaction descriptions
 * @returns {Object} { cleaned: string[], original: string[] }
 */
function batchCleanNarrations(narrations) {
  if (!Array.isArray(narrations)) {
    return { cleaned: [], original: [] };
  }

  return {
    cleaned: narrations.map(cleanNarration),
    original: narrations,
  };
}

// Generic transaction-flow words that surround a merchant/counterparty
// name without being part of it — stripped before picking the longest
// remaining word-run as the probable merchant name. Deliberately narrow:
// removing too aggressively risks eating a real merchant name that
// happens to contain one of these as a substring word (e.g. a business
// literally named "Transfer Logistics" would lose "Transfer" here too,
// which is an acceptable trade-off for a best-effort heuristic feeding
// the AI prompt as extra context, not a field anything else depends on).
const FLOW_WORDS = new Set([
  'TRANSFER', 'FROM', 'TO', 'PAYMENT', 'PURCHASE', 'POS', 'DEBIT', 'CREDIT',
  'VIA', 'WITHDRAWAL', 'DEPOSIT', 'FOR', 'OF', 'AND', 'THE', 'AT', 'BEING',
  'VALUE', 'TRANS', 'ONLINE', 'MOBILE', 'USSD', 'WEB', 'CHANNEL', 'A/C', 'ACCT',
]);

/**
 * Best-effort extraction of a probable merchant/counterparty name from an
 * already-cleaned narration — the longest run of consecutive alphabetic
 * words once generic transaction-flow words are stripped out. Not
 * authoritative (there's no ground truth to validate against), just an
 * extra signal handed to the AI categorisation prompt alongside the full
 * narration — never used as the sole basis for a decision.
 * @param {string} cleanedNarration - output of cleanNarration()
 * @returns {string|null} the probable merchant name, or null if nothing
 *   meaningful survives the strip
 */
function extractMerchantName(cleanedNarration) {
  if (!cleanedNarration || typeof cleanedNarration !== 'string') return null;

  const words = cleanedNarration.split(/\s+/).filter(Boolean);
  let bestRun = [];
  let currentRun = [];

  for (const word of words) {
    const isAlphabetic = /^[A-Za-z][A-Za-z.'-]*$/.test(word);
    const isFlowWord = FLOW_WORDS.has(word.toUpperCase());
    if (isAlphabetic && !isFlowWord) {
      currentRun.push(word);
      if (currentRun.length > bestRun.length) bestRun = currentRun;
    } else {
      currentRun = [];
    }
  }

  if (bestRun.length === 0) return null;
  const merchant = bestRun.join(' ').trim();
  return merchant.length >= 3 ? merchant : null;
}

module.exports = {
  cleanNarration,
  batchCleanNarrations,
  extractMerchantName,
};
