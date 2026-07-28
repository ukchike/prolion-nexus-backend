/**
 * Service-role Supabase client — the only place in this backend that uses
 * SUPABASE_SERVICE_KEY rather than the anon key. Needed for two things a
 * normal (RLS-respecting) client can't do: inviting a not-yet-registered
 * teammate via the Auth Admin API, and reading/writing company_members
 * rows across an authorization check this route enforces itself rather
 * than delegating to RLS (see routes/team.js).
 *
 * Never import this into anything the frontend can influence beyond an
 * already-authenticated req.user id — this key bypasses Row Level
 * Security entirely.
 */
const { createClient } = require('@supabase/supabase-js')

let client = null

function getAdminClient() {
  if (!client) {
    const url = process.env.SUPABASE_URL
      || (process.env.SUPABASE_PROJECT_ID && `https://${process.env.SUPABASE_PROJECT_ID}.supabase.co`)
    const key = process.env.SUPABASE_SERVICE_KEY
    if (!url || !key) {
      throw new Error(
        'SUPABASE_URL (or SUPABASE_PROJECT_ID) and SUPABASE_SERVICE_KEY must be set to manage team membership. Add them to Render environment variables (or .env locally).'
      )
    }
    client = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
  }
  return client
}

module.exports = { getAdminClient }
