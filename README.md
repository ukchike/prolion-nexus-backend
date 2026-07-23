# NEXUS Backend

Stateless parsing + AI categorisation service for NEXUS by Prolion.
Deployed on Railway. Never touches Supabase — file/transactions in, structured data out.

## Endpoints
- `GET /health` — liveness + a `config` block reporting whether Supabase/AI-provider env vars are actually set
- `POST /api/parse-statement` — multipart `file` (+ `bankCode` for PDFs: `auto` | `access` | `zenith` | `gtb`)
- `POST /api/categorise-transactions` — `{ transactions: [{id, description, debit, credit}] }`, max 1000/request, batches of 25
- `POST /api/assistant/query` — `{ question, snapshot, history }` → `{ answer, provider }`; answers questions about the caller's own financial data snapshot (see `src/lib/assistantEngine.js`)

## Parser calibration status
| Parser | Status |
|---|---|
| Access (specific) | CALIBRATED against TWO distinct real Access Bank export layouts — a branch-issued multi-line "block" statement (117 txns in production) and a tab-separated internet-banking self-service export (292/297 real txns, deposits total reconciled exactly to the statement footer). `parseAccessText` tries the block format first, falls back to the tab format automatically |
| Zenith (specific) | CALIBRATED — verified, totals match statement footer exactly |
| Generic multi-layout ('auto') | Covers the 4 common Nigerian internet/mobile-banking layout families. Verified against a 36-bank SPECIMEN pack — every statement reconciled to its own printed Total Credit / Total Debit / Closing Balance (543 txns, 0 failures). Specimens are synthetic; spot-check each genuinely new bank's REAL export before relying on it |
| GTB (specific) | Assumed layout, no real statement yet — falls back to 'auto' automatically if it finds nothing |
| CSV/Excel | Working (synthetic fixtures) |

The four generic layout families:
- WALLET — `01 Jun 2026 | details | amount | CREDIT/DEBIT | balance` (Carbon, OPay, Moniepoint, Kuda, PalmPay, LAPO, FairMoney, Renmoney, VFD, Accion)
- TRANSVALUE — trans date + value date + debit/credit slots (Unity, Providus, Titan, Signature, Fidelity, Stanbic, Union, UBA)
- REFERENCE — date + REF token + slots; handles amounts jammed against the description with no space (Citibank, Globus, Parallex, Optimus, GTB, Ecobank, Sterling, Polaris)
- NARRATION — `DD/MM/YYYY | narration | withdrawal | lodgement | balance` (StanChart, PremiumTrust, SunTrust, Nova, FirstBank, FCMB, Wema, Keystone)

Handles: "-" empty slots, negative (overdrawn) balances, reversal credits.
Calibration harness: `node scripts/calibration-run.js <extracted-text.txt>` reconciles every statement in a pack against its own printed control totals.

Dispatcher behaviour: bankCode 'auto' uses the generic engine directly; a bank-specific parser that finds zero transactions falls back to 'auto' automatically, and the response's `parserUsed` field reports which engine actually produced the result.

## AI categorisation
46-category FIRS-aligned taxonomy (`src/lib/categoryTaxonomy.js`):
4 Income, 24 Expense (4 Cost of Sales + 20 Operating), 16 Balance Sheet
(5 IFRS-for-SMEs subgroups), 1 Transfer, 1 Unclassified. CIT-sensitive
categories (Fines & Penalties, Donations, CSR, Entertainment) kept
distinct because they are not fully tax-deductible.

Provider is selected by `AI_PROVIDER` env var: `anthropic` (default,
Claude Haiku) or `groq` (free, Llama 3.3 70B). Same endpoint, same
response shape.

## Environment (.env locally, Railway variables when deployed)
```
PORT=4000
FRONTEND_URL=<vercel url>
AI_PROVIDER=groq
GROQ_API_KEY=<from console.groq.com>
ANTHROPIC_API_KEY=<optional, once funded>
```

## Testing
- `node test/parser.test.js` — parsers vs real fixtures (no network)
- `node test/categorise.test.js` — categorisation logic vs mocked AI (no key needed)
- `node scripts/smoke-test-categorise.js` — ONE real API call to whichever provider is configured
