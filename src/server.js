require('dotenv').config()
const express = require('express')
const cors = require('cors')
const statementsRouter = require('./routes/statements')
const categoriseRouter = require('./routes/categorise')

const app = express()
const PORT = process.env.PORT || 4000

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

app.use('/api', statementsRouter)
app.use('/api', categoriseRouter)

app.use((req, res) => {
  res.status(404).json({ error: `No route for ${req.method} ${req.path}` })
})

app.listen(PORT, () => {
  console.log(`NEXUS backend listening on http://localhost:${PORT}`)
  console.log(`Allowed CORS origins (raw): ${rawAllowedOrigins.join(', ') || '(none configured)'}`)
})
