/**
 * Team membership management for a NEXUS company — list/invite/remove.
 * Every route resolves the caller's own company_members row first (via
 * the service-role client, since a normal anon-key client can't see
 * across a whole table the way this needs to for the authorization
 * checks below) and enforces owner-only for invite/remove itself, rather
 * than delegating that to RLS. inviteUserByEmail needs the service-role
 * key regardless — it's an Auth Admin API call, not a table operation —
 * so once that client exists there's no separate anon-key path worth
 * maintaining alongside it.
 */
const express = require('express')
const { requireAuth } = require('../middleware/requireAuth')
const { getAdminClient } = require('../lib/supabaseAdmin')
const { seatLimitForTier } = require('../lib/seatLimits')

const router = express.Router()

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

async function getOwnMembership(supabaseAdmin, userId) {
  const { data, error } = await supabaseAdmin
    .from('company_members')
    .select('company_id, role')
    .eq('user_id', userId)
    .eq('status', 'active')
    .maybeSingle()
  if (error) throw error
  return data
}

router.get('/team', requireAuth, async (req, res) => {
  try {
    const supabaseAdmin = getAdminClient()
    const membership = await getOwnMembership(supabaseAdmin, req.user.id)
    if (!membership) {
      return res.status(404).json({ error: 'No active company membership found for this account.' })
    }

    const { data: members, error: membersError } = await supabaseAdmin
      .from('company_members')
      .select('id, user_id, role, status, invited_email, created_at')
      .eq('company_id', membership.company_id)
      .order('created_at', { ascending: true })
    if (membersError) throw membersError

    const userIds = (members || []).map((m) => m.user_id)
    const { data: profiles, error: profilesError } = await supabaseAdmin
      .from('profiles')
      .select('id, email, full_name')
      .in('id', userIds)
    if (profilesError) throw profilesError
    const profileById = new Map((profiles || []).map((p) => [p.id, p]))

    const result = (members || []).map((m) => ({
      id: m.id,
      role: m.role,
      status: m.status,
      isSelf: m.user_id === req.user.id,
      email: profileById.get(m.user_id)?.email || m.invited_email || null,
      name: profileById.get(m.user_id)?.full_name || null,
      createdAt: m.created_at,
    }))

    return res.json({ members: result, yourRole: membership.role })
  } catch (err) {
    console.error('Team list error:', err)
    return res.status(500).json({ error: err.message || 'Failed to load team members.' })
  }
})

router.post('/team/invite', requireAuth, async (req, res) => {
  try {
    const { email } = req.body
    if (!email || typeof email !== 'string' || !EMAIL_RE.test(email)) {
      return res.status(400).json({ error: 'A valid email address is required.' })
    }
    const normalizedEmail = email.trim().toLowerCase()

    const supabaseAdmin = getAdminClient()
    const membership = await getOwnMembership(supabaseAdmin, req.user.id)
    if (!membership) {
      return res.status(404).json({ error: 'No active company membership found for this account.' })
    }
    if (membership.role !== 'owner') {
      return res.status(403).json({ error: 'Only the company owner can invite teammates.' })
    }

    // Seat cap, checked BEFORE inviteUserByEmail so a company over its
    // limit never gets an email sent that it can't honour. Pending invites
    // count against the cap — they've effectively claimed their seat, and
    // ignoring them would let several invites go out at once and overshoot
    // the limit as they're accepted.
    const { data: company, error: companyError } = await supabaseAdmin
      .from('company_profiles')
      .select('complexity_level')
      .eq('id', membership.company_id)
      .maybeSingle()
    if (companyError) throw companyError

    const seatLimit = seatLimitForTier(company?.complexity_level)
    if (seatLimit !== null) {
      const { count, error: countError } = await supabaseAdmin
        .from('company_members')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', membership.company_id)
      if (countError) throw countError
      if ((count || 0) >= seatLimit) {
        return res.status(403).json({
          error: `Your plan includes ${seatLimit} team member${seatLimit === 1 ? '' : 's'}. Upgrade your plan in Settings to invite more.`,
        })
      }
    }

    const { data: existingInvite } = await supabaseAdmin
      .from('company_members')
      .select('id')
      .eq('company_id', membership.company_id)
      .eq('invited_email', normalizedEmail)
      .maybeSingle()
    if (existingInvite) {
      return res.status(409).json({ error: 'That email has already been invited to this company.' })
    }

    const { data: invited, error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(normalizedEmail)
    if (inviteError) {
      return res.status(400).json({ error: inviteError.message || 'Failed to send invite.' })
    }

    // An existing NEXUS user (owner of their own company, or already staff
    // elsewhere) accepting this invite later would collide with the "one
    // active company per user" constraint — reject now, with a clear
    // reason, rather than leaving a stray invited row that fails silently
    // when they try to accept it.
    const { data: alreadyActive } = await supabaseAdmin
      .from('company_members')
      .select('company_id')
      .eq('user_id', invited.user.id)
      .eq('status', 'active')
      .maybeSingle()
    if (alreadyActive && alreadyActive.company_id !== membership.company_id) {
      return res.status(409).json({ error: 'That person already belongs to a different NEXUS company and can’t be invited here.' })
    }

    const { error: memberError } = await supabaseAdmin
      .from('company_members')
      .insert({
        company_id: membership.company_id,
        user_id: invited.user.id,
        role: 'staff',
        status: 'invited',
        invited_email: normalizedEmail,
      })
    if (memberError) {
      if (memberError.code === '23505') {
        return res.status(409).json({ error: 'That person is already a member of this company.' })
      }
      throw memberError
    }

    return res.status(201).json({ invitedEmail: normalizedEmail })
  } catch (err) {
    console.error('Team invite error:', err)
    return res.status(500).json({ error: err.message || 'Failed to invite teammate.' })
  }
})

router.delete('/team/:memberId', requireAuth, async (req, res) => {
  try {
    const supabaseAdmin = getAdminClient()
    const membership = await getOwnMembership(supabaseAdmin, req.user.id)
    if (!membership) {
      return res.status(404).json({ error: 'No active company membership found for this account.' })
    }
    if (membership.role !== 'owner') {
      return res.status(403).json({ error: 'Only the company owner can remove teammates.' })
    }

    const { data: target, error: targetError } = await supabaseAdmin
      .from('company_members')
      .select('id, company_id, role')
      .eq('id', req.params.memberId)
      .maybeSingle()
    if (targetError) throw targetError
    if (!target || target.company_id !== membership.company_id) {
      return res.status(404).json({ error: 'Member not found.' })
    }
    // The owner's own row is always role 'owner' — this is what actually
    // blocks self-removal too, since the caller IS the owner here.
    if (target.role === 'owner') {
      return res.status(400).json({ error: 'The company owner can’t be removed.' })
    }

    const { error: deleteError } = await supabaseAdmin.from('company_members').delete().eq('id', target.id)
    if (deleteError) throw deleteError

    return res.status(204).send()
  } catch (err) {
    console.error('Team remove error:', err)
    return res.status(500).json({ error: err.message || 'Failed to remove teammate.' })
  }
})

module.exports = router
