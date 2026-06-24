require('dotenv').config()
const express = require('express')
const cors = require('cors')
const statementsRouter = require('./routes/statements')

const app = express()
const PORT = process.env.PORT || 4000

// Sprint 1: allow the local dev frontend and your deployed Vercel app.
// Add additional origins here as you deploy preview URLs.
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:5174',
  process.env.FRONTEND_URL, // set this in .env to your Vercel URL
].filter(Boolean)

app.use(cors({ origin: allowedOrigins }))
app.use(express.json())

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'nexus-backend', timestamp: new Date().toISOString() })
})

app.use('/api', statementsRouter)

app.use((req, res) => {
  res.status(404).json({ error: `No route for ${req.method} ${req.path}` })
})

app.listen(PORT, () => {
  console.log(`NEXUS backend listening on http://localhost:${PORT}`)
  console.log(`Allowed CORS origins: ${allowedOrigins.join(', ') || '(none configured)'}`)
})
