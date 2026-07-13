/**
 * Verifies the Supabase-issued JWT sent as `Authorization: Bearer <token>`
 * and attaches the authenticated user to req.user.
 *
 * Before this, /api/parse-statement and /api/categorise-transactions were
 * fully public — reachable by anyone with curl/Postman regardless of the
 * CORS allowlist in server.js, since CORS only restricts browser-issued
 * JS requests and is not a security boundary against direct API calls.
 * categorise-transactions in particular calls a paid AI API per request,
 * so an unauthenticated version of it is a direct cost/DoS vector, not
 * just a data-exposure one.
 */
const { createClient } = require('@supabase/supabase-js')

let supabase = null
function getClient() {
  if (!supabase) {
    const url = process.env.SUPABASE_URL
      || (process.env.SUPABASE_PROJECT_ID && `https://${process.env.SUPABASE_PROJECT_ID}.supabase.co`)
    const key = process.env.SUPABASE_ANON_KEY
    if (!url || !key) {
      throw new Error(
        'SUPABASE_URL (or SUPABASE_PROJECT_ID) and SUPABASE_ANON_KEY must be set to verify requests. Add them to Railway environment variables (or .env locally).'
      )
    }
    supabase = createClient(url, key)
  }
  return supabase
}

function extractBearerToken(authorizationHeader) {
  if (!authorizationHeader) return null
  const match = authorizationHeader.match(/^Bearer\s+(.+)$/i)
  return match ? match[1].trim() : null
}

async function requireAuth(req, res, next) {
  try {
    const token = extractBearerToken(req.headers.authorization)
    if (!token) {
      return res.status(401).json({ error: 'Missing Authorization header — sign in and retry.' })
    }

    const { data, error } = await getClient().auth.getUser(token)
    if (error || !data?.user) {
      return res.status(401).json({ error: 'Invalid or expired session — please sign in again.' })
    }

    req.user = data.user
    next()
  } catch (err) {
    console.error('Auth verification error:', err.message)
    return res.status(500).json({ error: 'Could not verify authentication.' })
  }
}

module.exports = { requireAuth, extractBearerToken }
