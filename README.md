# NEXUS Backend — Statement Parsing Service

A stateless Node.js/Express service that takes a bank statement file
(PDF, CSV, or Excel) and returns structured transactions. It does **not**
touch Supabase or any database — the frontend (`nexus-app`) is responsible
for storing the original file and the parsed transactions. This service's
only job is: file in, transactions out.

## Calibration notice

**Access Bank and Zenith Bank are now calibrated against real statements**
(both from RAL Paints Ltd, May/June 2026):

- `src/parsers/access.js` — multi-line blocks, debit/credit in separate
  columns. See `test/fixtures/access-real-sample.txt`.
- `src/parsers/zenith.js` — different again: two leading dates, amounts
  sometimes inline with the description, debit/credit direction inferred
  from the running balance rather than separate columns. See
  `test/fixtures/zenith-real-sample.txt`.

Both were validated not just by checking individual fields, but by
confirming totals against the statement's own footer summary (total
debits, total credits, closing balance) — an independent cross-check
that catches errors a field-by-field comparison could miss.

**GTB is still uncalibrated** — built from common Nigerian e-statement
layout patterns, verified only against synthetic test data, never tested
against a real GTB statement. Given that all three banks turned out to
have genuinely different layouts from one another, do not assume GTB's
current single-line-per-transaction logic is correct — test it the same
way Access and Zenith just were before trusting it on real client data.

If a real statement doesn't parse correctly, use the `rawTextPreview`
field in the API response (or the "Show raw extracted text" button in
the frontend) to see exactly what `pdf-parse` extracted, then build a
real parser for it the way `access.js` and `zenith.js` were built —
don't assume it'll resemble either of those two structurally.

## Setup

```bash
npm install
cp .env.example .env
npm run dev
```

Confirm it's running:
```bash
curl http://localhost:4000/health
```

## Testing the parser

```bash
npm test
```

This runs `test/parser.test.js` against two synthetic fixtures:
- `test/fixtures/sample-statement.csv`
- `test/fixtures/sample-gtb-statement.pdf` (regenerate with
  `node test/generate-fixture-pdf.js` if needed)

## API

### `GET /health`
Returns `{ status: 'ok' }` — use this to confirm the service is up.

### `POST /api/parse-statement`
Multipart form data:
- `file` (required) — the statement file (.pdf, .csv, .xlsx, .xls)
- `bankCode` (required for PDF only) — one of `gtb`, `access`, `zenith`

Response:
```json
{
  "fileName": "statement.pdf",
  "fileType": "pdf",
  "bankCode": "gtb",
  "transactionCount": 8,
  "unparsedCount": 0,
  "transactions": [
    { "transaction_date": "2025-01-01", "description": "...", "debit": null, "credit": 500000, "balance": 500000 }
  ],
  "unparsedLines": [],
  "rawTextPreview": "..."
}
```

## Adding a new bank

1. Create `src/parsers/yourbank.js` — start by copying `access.js` as a template
2. Register it in `src/parsers/index.js` (`SUPPORTED_BANKS` array and
   `PDF_TEXT_PARSERS` map)
3. Add it to `BANK_OPTIONS` in the frontend's `StatementUpload.jsx`
4. Get a real sample statement and calibrate `assignAmounts()` /
   `textHelpers.js` patterns against it

## Known dependency note

`exceljs` depends on an older `uuid` version with a moderate-severity
advisory (buffer bounds check, only relevant if `uuid` is called with a
caller-supplied buffer — not how `exceljs` uses it internally). Run
`npm audit` periodically and re-evaluate if `exceljs` ships an update.

## Deployment

This is a long-running Node server — deploy to **Railway** or **Render**,
not Vercel (Vercel is for the static frontend). After deploying:
1. Set `FRONTEND_URL` in this service's environment variables to your
   deployed Vercel URL (for CORS)
2. Set `VITE_API_BASE_URL` in the frontend's Vercel environment variables
   to this service's deployed URL
