/**
 * Zenith Bank statement parser.
 *
 * NOT YET CALIBRATED — currently reuses the generic GTB parsing logic.
 * See access.js for the same note: test against a real Zenith statement
 * and override here independently once you see how its layout differs.
 */

const { parseGTBText } = require('./gtb')

function parseZenithText(rawText) {
  // Identical to GTB for now. Override here once calibrated.
  return parseGTBText(rawText)
}

module.exports = { parseZenithText }
