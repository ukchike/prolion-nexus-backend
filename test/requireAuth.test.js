const { extractBearerToken } = require('../src/middleware/requireAuth')

let failures = 0
function check(label, condition) {
  console.log(`  ${condition ? 'PASS' : 'FAIL'} - ${label}`)
  if (!condition) failures++
}

function testExtractBearerToken() {
  console.log('\n--- extractBearerToken ---')
  check('extracts token from a standard Bearer header', extractBearerToken('Bearer abc.def.ghi') === 'abc.def.ghi')
  check('is case-insensitive on the "Bearer" scheme', extractBearerToken('bearer abc.def.ghi') === 'abc.def.ghi')
  check('trims incidental whitespace around the token', extractBearerToken('Bearer   abc.def.ghi  ') === 'abc.def.ghi')
  check('returns null for a missing header', extractBearerToken(undefined) === null)
  check('returns null for an empty header', extractBearerToken('') === null)
  check('returns null when the scheme is missing entirely', extractBearerToken('abc.def.ghi') === null)
  check('returns null for a non-Bearer scheme', extractBearerToken('Basic dXNlcjpwYXNz') === null)
}

function main() {
  testExtractBearerToken()
  console.log('\n=================================')
  console.log(failures === 0 ? 'ALL CRITICAL CHECKS PASSED' : `${failures} CHECK(S) FAILED`)
  console.log('NOTE: full requireAuth() verification needs a live Supabase call (auth.getUser)')
  console.log('and is not offline-testable — verify manually against a real session token.')
  console.log('=================================')
  process.exit(failures === 0 ? 0 : 1)
}
main()
