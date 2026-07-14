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

const MAX_ATTEMPTS = 2

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

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

/**
 * `auth.getUser(token)` normally *resolves* with `{ error }` for an
 * expired/invalid token (handled below as a clean 401) — but a genuine
 * network blip between this server and Supabase's auth endpoint makes it
 * *reject* instead, which used to fall straight into a single catch-all
 * "Could not verify authentication." with the real cause visible only in
 * server logs. This retries once on that kind of failure (mirroring the
 * groqClient retry pattern) before giving up, and every failure path now
 * logs a distinguishable, greppable reason.
 */
async function verifyToken(token, attempt = 1) {
  try {
    return await getClient().auth.getUser(token)
  } catch (err) {
    if (attempt < MAX_ATTEMPTS) {
      console.warn(`[requireAuth] auth.getUser threw on attempt ${attempt} (${err.message}) — retrying once`)
      await sleep(300)
      return verifyToken(token, attempt + 1)
    }
    throw err
  }
}

async function requireAuth(req, res, next) {
  const token = extractBearerToken(req.headers.authorization)
  if (!token) {
    return res.status(401).json({ error: 'Missing Authorization header — sign in and retry.' })
  }

  try {
    getClient()
  } catch (err) {
    console.error(`[requireAuth] client init failed: ${err.message}`)
    return res.status(500).json({ error: 'Could not verify authentication — server is missing Supabase configuration.' })
  }

  try {
    const { data, error } = await verifyToken(token)
    if (error || !data?.user) {
      console.warn(`[requireAuth] auth.getUser rejected the token: ${error?.message || 'no user returned'}`)
      return res.status(401).json({ error: 'Invalid or expired session — please sign in again.' })
    }
    req.user = data.user
    next()
  } catch (err) {
    console.error(`[requireAuth] auth.getUser threw after retry: ${err.name || 'Error'}: ${err.message}`)
    return res.status(503).json({ error: 'Could not reach the authentication service — please try again in a moment.' })
  }
}

module.exports = { requireAuth, extractBearerToken }
