/**
 * Providus Bank statement parser.
 *
 * CALIBRATED against a real Providus "Statement of Account" (The
 * Scentjunkie Place Ltd, Jul 2026, 24 pages). Verified: all 519
 * transactions (274 debit / 245 credit, matching the statement's own
 * DEB./CRED. COUNT footers exactly) reconstruct the running balance
 * chain from OPENING BAL. (7,808,662.13) to CLOSING BAL.
 * (14,246,895.90) with zero drift at any step, and TOTAL CREDIT matches
 * the printed footer (22,151,852.00) exactly. The parsed TOTAL DEBIT
 * (15,713,618.23) is the value implied by Opening + Credit − Closing
 * and is off by 59.23 from the statement's own printed TOTAL DEBIT
 * footer (15,713,559.00) — since every individual balance step is
 * exact, this is the statement's own footer rollup being marginally
 * inconsistent (not uncommon on real bank exports), not a parsing gap.
 * Layout is
 * tab-separated: "<Txn Date>\t<Val Date> <remarks...>" starts a block,
 * remarks wrap across further lines, and the block ends on an isolated
 * "<amount>\t<balance>" line. Only one movement amount appears per
 * transaction (no DR/CR marker), so direction is inferred by comparing
 * each new balance against a running balance seeded from the
 * statement's own OPENING BAL. line — same technique as zenith.js.
 * Page breaks ("-- N of 24 --") never fall inside a transaction block.
 */

const { normaliseDate } = require('./textHelpers')

const BLOCK_START_PATTERN = /^(\d{1,2}-\d{1,2}-\d{4})\s*\t\s*(\d{1,2}-\d{1,2}-\d{4})\s+(.*)$/
const TRAILING_AMOUNT_PATTERN = /^([\d,]+\.\d{2})\s*\t\s*([\d,]+\.\d{2})\s*$/
const OPENING_BALANCE_PATTERN = /OPENING BAL\.\s*\t?\s*([\d,]+\.\d{2})/i
const SKIP_LINE_PATTERN = /^(TXN DATE|OPENING BAL\.|CLOSING BAL\.|TOTAL DEBIT|TOTAL CREDIT|DEB\.\s*COUNT|CRED\.\s*COUNT|--\s*\d+\s+of\s+\d+\s*--$)/i

function parseAmount(raw) {
  const value = parseFloat(raw.replace(/,/g, ''))
  return Number.isNaN(value) ? null : value
}

/** Turns a finished block into { transaction_date, description, amount,
 * balance } — direction (debit vs credit) is resolved by the caller,
 * which has the running balance this block needs to be compared
 * against. Returns null if the block doesn't actually have both a
 * header and a trailing amount/balance row — defensive only, since
 * finalizeBlock is never called without both having already matched at
 * the call site. */
function finalizeBlock(blockLines) {
  const first = blockLines[0]
  const headerMatch = first.match(BLOCK_START_PATTERN)
  const last = blockLines[blockLines.length - 1]
  const amountsMatch = last.match(TRAILING_AMOUNT_PATTERN)
  if (!headerMatch || !amountsMatch) return null

  const [, txnDateRaw, , remarksStart] = headerMatch
  const [, amountRaw, balanceRaw] = amountsMatch

  const description = [remarksStart, ...blockLines.slice(1, -1)].join(' ').replace(/\s+/g, ' ').trim()
  if (!description) return null

  return {
    transaction_date: normaliseDate(txnDateRaw),
    description,
    amount: parseAmount(amountRaw),
    balance: parseAmount(balanceRaw),
  }
}

function parseProvidusText(rawText) {
  const lines = rawText.split('\n').map((l) => l.replace(/\s+$/, '')).filter((l) => l.trim().length > 0)
  const openingMatch = rawText.match(OPENING_BALANCE_PATTERN)
  let runningBalance = openingMatch ? parseAmount(openingMatch[1]) : null

  const transactions = []
  const unparsedLines = []
  let current = null

  function flushIncomplete() {
    if (current) {
      unparsedLines.push({
        line: current.join(' | '),
        reason: 'transaction block never reached its Amount/Balance line (often means it was cut off at a page break)',
      })
    }
    current = null
  }

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (SKIP_LINE_PATTERN.test(line)) continue // repeated table header / footer totals / page marker

    if (BLOCK_START_PATTERN.test(line)) {
      flushIncomplete()
      current = [line]
    } else if (current) {
      current.push(line)
    } else {
      continue // noise before the first transaction (statement header block)
    }

    if (TRAILING_AMOUNT_PATTERN.test(current[current.length - 1])) {
      const block = finalizeBlock(current)
      current = null

      if (!block) continue

      if (runningBalance === null) {
        unparsedLines.push({ line: block.description, reason: 'cannot determine debit vs credit direction — no opening balance found to compare against' })
        continue
      }

      let debit = null
      let credit = null
      if (block.balance > runningBalance) {
        credit = block.amount
      } else if (block.balance < runningBalance) {
        debit = block.amount
      } else {
        unparsedLines.push({ line: block.description, reason: 'balance unchanged — cannot determine movement direction' })
        continue
      }

      transactions.push({
        transaction_date: block.transaction_date,
        description: block.description,
        debit,
        credit,
        balance: block.balance,
      })
      runningBalance = block.balance
    }
  }
  flushIncomplete()

  return { transactions, unparsedLines }
}

module.exports = { parseProvidusText }
