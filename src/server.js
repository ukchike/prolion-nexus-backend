require('dotenv').config()
const express = require('express')
const cors = require('cors')
const statementsRouter = require('./routes/statements')
const categoriseRouter = require('./routes/categorise')
const assistantRouter = require('./routes/assistant')
const { generalLimiter } = require('./middleware/rateLimiters')
const { getProvider } = require('./lib/aiProvider')

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
      if (!isAllowed) {
        console.log(
          `CORS rejected — incoming origin: "${origin}" | normalized: "${normalized}" | configured: [${rawAllowedOrigins.join(', ')}]`
        )
      }
      callback(null, isAllowed)
    },
  })
)
app.use(express.json({ limit: '5mb' }))

// Liveness always reports 'ok' (the process is up), but `config` surfaces
// missing env vars proactively — without this, a deployment missing
// SUPABASE_URL or an AI provider key still passes health checks and looks
// "up" while every real endpoint 500s on first use.
app.get('/health', (req, res) => {
  const supabaseConfigured = !!(
    (process.env.SUPABASE_URL || process.env.SUPABASE_PROJECT_ID) && process.env.SUPABASE_ANON_KEY
  )
  let aiProviderConfigured = false
  let aiProviderName = null
  try {
    const provider = getProvider()
    aiProviderName = provider.name
    aiProviderConfigured = !!process.env[provider.requiredEnvVar]
  } catch {
    // AI_PROVIDER set to an unrecognised value — surfaced via aiProviderName: null below.
  }

  res.json({
    status: 'ok',
    service: 'nexus-backend',
    timestamp: new Date().toISOString(),
    config: {
      supabase: supabaseConfigured,
      aiProvider: aiProviderName,
      aiProviderKey: aiProviderConfigured,
    },
  })
})

app.use('/api', generalLimiter)
app.use('/api', statementsRouter)
app.use('/api', categoriseRouter)
app.use('/api', assistantRouter)

app.use((req, res) => {
  res.status(404).json({ error: `No route for ${req.method} ${req.path}` })
})

// Trailing 4-arg handler — catches anything that bypasses a route's own
// try/catch (malformed JSON bodies from express.json(), multer errors like
// LIMIT_FILE_SIZE, etc). Without this, those fall through to Express's
// default handler, which returns an HTML page instead of this API's
// { error } JSON contract and can include a stack trace. Never sends the
// stack to the client — only logs it server-side — regardless of NODE_ENV.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err)
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Malformed JSON in request body.' })
  }
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: 'File too large.' })
  }
  res.status(err.status || 500).json({ error: 'Internal server error.' })
})

app.listen(PORT, () => {
  console.log(`NEXUS backend listening on http://localhost:${PORT}`)
  console.log(`Allowed CORS origins (raw): ${rawAllowedOrigins.join(', ') || '(none configured)'}`)
})
