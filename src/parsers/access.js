/**
 * Access Bank statement parser.
 *
 * NOT YET CALIBRATED — currently reuses the generic GTB parsing logic
 * since both banks tend to use a similar date/description/debit/credit/
 * balance column layout in their downloadable statements. Once you have
 * a real Access Bank statement, test it (see README) and adjust
 * `assignAmounts()` or the regex patterns in textHelpers.js if the
 * layout differs — keep those changes in THIS file via a local override,
 * not in gtb.js, so the two banks can diverge independently.
 */

const { parseGTBText } = require('./gtb')

function parseAccessText(rawText) {
  // Identical to GTB for now. Override here once calibrated.
  return parseGTBText(rawText)
}

module.exports = { parseAccessText }
