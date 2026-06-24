/**
 * One-off script to generate a synthetic bank-statement-like PDF for
 * testing the parser pipeline end-to-end, since no real GTB statement
 * was available during development. Run with: node test/generate-fixture-pdf.js
 *
 * This intentionally mirrors the same transactions as sample-statement.csv
 * so both fixtures can be checked against the same expected totals.
 */

const fs = require('fs')
const path = require('path')
const PDFDocument = require('pdfkit')

const doc = new PDFDocument({ margin: 40 })
const outputPath = path.join(__dirname, 'fixtures', 'sample-gtb-statement.pdf')
const stream = fs.createWriteStream(outputPath)
doc.pipe(stream)

doc.fontSize(14).text('GTBank - Account Statement (synthetic test fixture)', { align: 'center' })
doc.moveDown()
doc.fontSize(9)
doc.text('Trans Date    Value Date    Description                          Debit         Credit        Balance')
doc.text('--------------------------------------------------------------------------------------------------')

const lines = [
  '01-Jan-2025  01-Jan-2025  TRANSFER FROM DANGOTE AGRO LTD                              500,000.00  500,000.00',
  '03-Jan-2025  03-Jan-2025  POS PURCHASE SHOPRITE IKEJA          15,000.00               485,000.00',
  '05-Jan-2025  05-Jan-2025  PAYMENT TO STAFF SALARY JAN          120,000.00              365,000.00',
  '07-Jan-2025  07-Jan-2025  TRANSFER FROM JOHN ADEYEMI                                    75,000.00  440,000.00',
  '10-Jan-2025  10-Jan-2025  VAT PAYMENT FIRS                       8,500.00              431,500.00',
  '12-Jan-2025  12-Jan-2025  RENT PAYMENT OFFICE                 200,000.00               231,500.00',
  '15-Jan-2025  15-Jan-2025  CASH DEPOSIT                                                  50,000.00  281,500.00',
  '18-Jan-2025  18-Jan-2025  SMS ALERT CHARGE                          4.00                281,496.00',
]

lines.forEach((line) => doc.text(line))

doc.end()
stream.on('finish', () => {
  console.log(`Generated fixture: ${outputPath}`)
})
