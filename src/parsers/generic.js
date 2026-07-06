/**
 * Generic multi-layout parser for Nigerian bank statements.
 *
 * Instead of one parser per bank, this recognises the four layout
 * FAMILIES that Nigerian internet/mobile-banking exports cluster into,
 * detecting the family per line:
 *
 *  WALLET      "01 Jun 2026  DESCRIPTION  604,043.09  DEBIT  4,235,989.19"
 *              (Carbon, OPay, Moniepoint, Kuda, PalmPay, LAPO, FairMoney,
 *               Renmoney, VFD, Accion — MFB/fintech apps)
 *  TRANSVALUE  "04-Jun-2026 04-Jun-2026  DESCRIPTION  -  2,575,076.37  5,799,187.54"
 *              (Unity, Providus, Titan, Signature, Fidelity, Stanbic,
 *               Union, UBA — trans date + value date, debit/credit slots)
 *  REFERENCE   "28-Jun-26 REF054659  DESCRIPTION198,057.18  -  13,268,032.41"
 *              (Citibank, Globus, Parallex, Optimus, GTB, Ecobank,
 *               Sterling, Polaris — ref token; amounts sometimes jammed
 *               against the description with NO space)
 *  NARRATION   "04/06/2026  DESCRIPTION  474,540.40  -  2,525,316.68"
 *              (StanChart, PremiumTrust, SunTrust, Nova, FirstBank,
 *               FCMB, Wema, Keystone — withdrawal/lodgement slots)
 *
 * Handles: "-" as an empty debit/credit slot, negative running balances
 * (overdrawn accounts), and amounts with no whitespace separating them
 * from the description text.
 *
 * CALIBRATION STATUS: verified against a 36-statement specimen pack
 * (self-reconciled against each statement's own printed totals). These
 * specimens are labelled computer-generated test data — real bank
 * exports may still differ, so every genuinely new bank should be
 * spot-checked against a real statement before being trusted, same
 * discipline as Access/Zenith.
 */

const { normaliseDate } = require('./textHelpers')

// Amounts must START with a digit — prevents a jammed "LTD198,057.18"
// from mis-splitting as description "LTD198" + amount ",057.18".
const AMT = '\\d[\\d,]*\\.\\d{2}'
const SLOT = `(?:${AMT}|-)` // a debit/credit column: an amount or a "-" placeholder
const BAL = `-?${AMT}`      // running balance may be negative (overdrawn)

const PATTERNS = [
  {
    family: 'WALLET',
    // date(spaces) | description | amount | CREDIT/DEBIT | balance
    regex: new RegExp(`^(\\d{1,2}\\s+[A-Za-z]{3}\\s+\\d{4})\\s+(.+?)\\s*(${AMT})\\s+(CREDIT|DEBIT)\\s+(${BAL})\\s*$`),
    build: (m) => ({
      transaction_date: normaliseDate(m[1].trim().replace(/\s+/g, '-')),
      description: m[2].trim(),
      debit: m[4] === 'DEBIT' ? parseAmount(m[3]) : null,
      credit: m[4] === 'CREDIT' ? parseAmount(m[3]) : null,
      balance: parseAmount(m[5]),
    }),
  },
  {
    family: 'TRANSVALUE',
    // trans date | value date | description | debit-slot | credit-slot | balance
    regex: new RegExp(`^(\\d{1,2}-[A-Za-z]{3}-\\d{4})\\s+(\\d{1,2}-[A-Za-z]{3}-\\d{4})\\s+(.+?)\\s*(${SLOT})\\s+(${SLOT})\\s+(${BAL})\\s*$`),
    build: (m) => ({
      transaction_date: normaliseDate(m[1]),
      description: m[3].trim(),
      debit: slotAmount(m[4]),
      credit: slotAmount(m[5]),
      balance: parseAmount(m[6]),
    }),
  },
  {
    family: 'REFERENCE',
    // date(2-or-4-digit year) | REF token | description | debit-slot | credit-slot | balance
    regex: new RegExp(`^(\\d{1,2}-[A-Za-z]{3}-\\d{2,4})\\s+(REF\\S*)\\s+(.+?)\\s*(${SLOT})\\s+(${SLOT})\\s+(${BAL})\\s*$`),
    build: (m) => ({
      transaction_date: normaliseDate(m[1]),
      description: m[3].trim(),
      debit: slotAmount(m[4]),
      credit: slotAmount(m[5]),
      balance: parseAmount(m[6]),
    }),
  },
  {
    family: 'NARRATION',
    // date(slashes) | description | withdrawal-slot | lodgement-slot | balance
    regex: new RegExp(`^(\\d{1,2}\\/\\d{1,2}\\/\\d{2,4})\\s+(.+?)\\s*(${SLOT})\\s+(${SLOT})\\s+(${BAL})\\s*$`),
    build: (m) => ({
      transaction_date: normaliseDate(m[1]),
      description: m[2].trim(),
      debit: slotAmount(m[3]),
      credit: slotAmount(m[4]),
      balance: parseAmount(m[5]),
    }),
  },
]

function parseAmount(raw) {
  if (raw === null || raw === undefined) return null
  const value = parseFloat(String(raw).replace(/,/g, ''))
  return Number.isNaN(value) ? null : value
}

function slotAmount(slot) {
  if (!slot || slot === '-') return null
  const value = parseAmount(slot)
  return value > 0 ? value : null
}

// A line is transaction-LIKE (so worth reporting if unparsed) when it
// starts with any of the four date shapes. Header rows, totals rows,
// and boilerplate never do.
const TXN_LIKE = /^(\d{1,2}\s+[A-Za-z]{3}\s+\d{4}|\d{1,2}-[A-Za-z]{3}-\d{2,4}|\d{1,2}\/\d{1,2}\/\d{2,4})\s/

function parseGenericText(rawText) {
  const lines = rawText.split('\n').map((l) => l.trim()).filter(Boolean)
  const transactions = []
  const unparsedLines = []
  const familyCounts = {}

  for (const line of lines) {
    let matched = false
    for (const { family, regex, build } of PATTERNS) {
      const m = line.match(regex)
      if (!m) continue

      const txn = build(m)
      // A row with a date but no movement and no description is noise,
      // not a transaction.
      if (!txn.transaction_date || !txn.description || (txn.debit === null && txn.credit === null)) break

      transactions.push(txn)
      familyCounts[family] = (familyCounts[family] || 0) + 1
      matched = true
      break
    }

    if (!matched && TXN_LIKE.test(line)) {
      unparsedLines.push({ line, reason: 'looked like a transaction row but matched no known layout family' })
    }
  }

  return { transactions, unparsedLines, familyCounts }
}

module.exports = { parseGenericText }
