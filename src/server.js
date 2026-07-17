require('dotenv').config()
const express = require('express')
const cors = require('cors')
const statementsRouter = require('./routes/statements')
const categoriseRouter = require('./routes/categorise')
const assistantRouter = require('./routes/assistant')
const { generalLimiter } = require('./middleware/rateLimiters')

const app = express()
const PORT = process.env.PORT || 4000

// Railway (and most PaaS hosts) sit the app behind a reverse proxy —
// without this, req.ip resolves to the proxy's own address, and every
// caller would share one rate-limit bucket. Trusting exactly one hop
// (the platform's own edge, not arbitrary client-supplied headers) is
// the standard-practice setting for this deployment shape.
app.set('trust proxy', 1)

const rawAllowedOrigins = [
  'http://localhost:5173',
  'http://localhost:5174',
  process.env.FRONTEND_URL,
].filter(Boolean)

/**
 * Normalises origins before comparison — env vars are hand-typed and a
 * trailing slash or stray whitespace is invisible in a dashboard but
 * breaks exact-string matching.
 */
function normalizeOrigin(origin) {
  if (!origin) return ''
  return origin.trim().replace(/\/+$/, '').toLowerCase()
}

const normalizedAllowedOrigins = rawAllowedOrigins.map(normalizeOrigin)

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true)
      const normalized = normalizeOrigin(origin)
      const isAllowed = normalizedAllowedOrigins.includes(normalized)
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

app.use('/api', generalLimiter)
app.use('/api', statementsRouter)
app.use('/api', categoriseRouter)
app.use('/api', assistantRouter)

app.use((req, res) => {
  res.status(404).json({ error: `No route for ${req.method} ${req.path}` })
})

app.listen(PORT, () => {
  console.log(`NEXUS backend listening on http://localhost:${PORT}`)
  console.log(`Allowed CORS origins (raw): ${rawAllowedOrigins.join(', ') || '(none configured)'}`)
})
