/**
 * Team seat caps per plan tier. These mirror nexus-app's
 * src/lib/pricingTiers.js — the two live in separate repos, so the values
 * are duplicated deliberately rather than shared through a package, but
 * they must be changed together. The frontend's copy drives what the
 * Team tab offers; this copy is the one that actually enforces, since a
 * client-side cap is a courtesy, not a control.
 *
 * The number is TOTAL seats including the owner, and null means
 * unlimited. Tier keys are company_profiles.complexity_level values.
 */
const SEAT_LIMITS = {
  starter: 1,
  growing: 3,
  professional: null,
}

// An unrecognised/missing tier falls back to the most restrictive cap
// rather than to unlimited — failing closed is the safe direction here.
const FALLBACK_LIMIT = SEAT_LIMITS.starter

function seatLimitForTier(tierKey) {
  return Object.prototype.hasOwnProperty.call(SEAT_LIMITS, tierKey)
    ? SEAT_LIMITS[tierKey]
    : FALLBACK_LIMIT
}

module.exports = { SEAT_LIMITS, seatLimitForTier }
