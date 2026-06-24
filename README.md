# NEXUS Backend — Statement Parsing Service

A stateless Node.js/Express service that takes a bank statement file
(PDF, CSV, or Excel) and returns structured transactions. It does **not**
touch Supabase or any database — the frontend (`nexus-app`) is responsible
for storing the original file and the parsed transactions. This service's
only job is: file in, transactions out.

## Calibration notice

**Access Bank is now calibrated against a real statement** (RAL Paints
Ltd, June 2026) — see `src/parsers/access.js` for the full layout
breakdown and `test/fixtures/access-real-sample.txt` /
`test/parser.test.js` (testAccessRealSample) for the regression test.
Access's layout turned out to be fundamentally different from GTB's —
multi-line blocks rather than one line per transaction — which is why
its parser is now a real, independent implementation rather than a
GTB clone.

**GTB and Zenith are still uncalibrated** — built from common Nigerian
e-statement layout patterns, verified only against synthetic test data.
Test each against a real statement before trusting it, the same way
Access just was. If a real GTB or Zenith statement turns out to use
Access's multi-line block structure instead of single-line rows, copy
the block-detection approach in `access.js` rather than starting from
scratch.

If a real statement doesn't parse correctly, use the `rawTextPreview`
field in the API response (or the "Show raw extracted text" button in
the frontend) to see exactly what `pdf-parse` extracted, then adjust
the relevant bank's parser file.

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
