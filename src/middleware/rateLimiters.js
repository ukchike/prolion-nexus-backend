/**
 * Rate limiting — layered so a flood of requests can't reach the
 * expensive parts of the app (Supabase auth verification, the AI API)
 * regardless of whether the caller ever authenticates.
 */
const { rateLimit, ipKeyGenerator } = require('express-rate-limit')

// Backstop applied to every /api route before auth even runs — a flood
// of requests still costs a round trip to Supabase's auth server to
// verify (or reject) each token, so this needs to exist pre-auth too.
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please wait a few minutes and try again.' },
})

// Keyed by the authenticated user (after requireAuth has run), not just
// IP — otherwise one abusive user behind a shared NAT/proxy could starve
// everyone else on that IP. Falls back to IP only if something calls
// this before auth, which shouldn't happen in practice — the IP fallback
// goes through the library's own ipKeyGenerator helper so IPv6 addresses
// are normalised per-subnet instead of compared as raw strings (a raw
// req.ip fallback lets an IPv6 caller dodge the limit by varying the
// address's low bits on every request).
function byUserOrIp(req) {
  return req.user?.id || ipKeyGenerator(req.ip)
}

// Categorisation calls a paid AI API per request — the actual cost
// driver — so it gets the tightest limit. A single "Categorise" click
// already batches internally (categorisationEngine.js), so a legitimate
// user rarely needs more than a handful of these per session.
const categoriseLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: byUserOrIp,
  message: { error: 'Too many categorisation requests. Please wait a few minutes and try again.' },
})

// Parsing is CPU/memory work (PDF/CSV/Excel parsing of up to 10MB
// files), not a paid API call, but still real compute worth bounding.
const parseLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: byUserOrIp,
  message: { error: 'Too many upload requests. Please wait a few minutes and try again.' },
})

module.exports = { generalLimiter, categoriseLimiter, parseLimiter }
