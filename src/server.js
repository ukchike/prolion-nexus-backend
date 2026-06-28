require('dotenv').config()
const express = require('express')
const cors = require('cors')
const statementsRouter = require('./routes/statements')
const categoriseRouter = require('./routes/categorise')

const app = express()
const PORT = process.env.PORT || 4000

// Sprint 1: allow the local dev frontend and your deployed Vercel app.
// Add additional origins here as you deploy preview URLs.
const rawAllowedOrigins = [
  'http://localhost:5173',
  'http://localhost:5174',
  process.env.FRONTEND_URL, // set this in .env / Railway to your Vercel URL
].filter(Boolean)

/**
 * Trims, lowercases, and strips a trailing slash. Browsers send the Origin
 * header in a strict canonical form, but env vars are hand-typed/pasted and
 * easy to get slightly wrong (trailing slash, stray whitespace, different
 * case). Normalizing both sides before comparing avoids exact-string-match
 * failures that are invisible when eyeballing the value in a dashboard.
 */
function normalizeOrigin(origin) {
  if (!origin) return ''
  return origin.trim().replace(/\/+$/, '').toLowerCase()
}

const normalizedAllowedOrigins = rawAllowedOrigins.map(normalizeOrigin)

app.use(
  cors({
    origin: (origin, callback) => {
      // `origin` is undefined for same-origin requests, curl, health checks,
      // server-to-server calls, etc. — always allow those through.
      if (!origin) return callback(null, true)

      const normalized = normalizeOrigin(origin)
      const isAllowed = normalizedAllowedOrigins.includes(normalized)

      // Logged on every request so Railway's Deploy Logs show the exact
      // raw Origin header the browser sent, compared against what's
      // configured — this removes all guesswork if CORS still fails.
      console.log(
        `CORS check — incoming origin: "${origin}" | normalized: "${normalized}" | allowed: ${isAllowed} | configured: [${rawAllowedOrigins.join(', ')}]`
      )

      callback(null, isAllowed)
    },
  })
)
app.use(express.json({ limit: '5mb' }))

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'nexus-backend', timestamp: new Date().toISOString() })
})

app.use('/api', statementsRouter)
app.use('/api', categoriseRouter)

app.use((req, res) => {
  res.status(404).json({ error: `No route for ${req.method} ${req.path}` })
})

app.listen(PORT, () => {
  console.log(`NEXUS backend listening on http://localhost:${PORT}`)
  console.log(`Allowed CORS origins (raw): ${rawAllowedOrigins.join(', ') || '(none configured)'}`)
})
