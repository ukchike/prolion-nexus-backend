const crypto = require('node:crypto')

/**
 * A first password for an invited teammate, generated here and handed to the
 * owner to pass on.
 *
 * The alphabet deliberately drops the characters people misread when a
 * password is read aloud or copied off a screen — O/0, l/1/I, and the pairs
 * that look alike in most sans-serif faces. That is the whole point of this
 * password: it exists to be communicated once, by a human, and then replaced
 * on first sign-in. One transcription error turns a two-minute handover into
 * a support conversation.
 *
 * randomInt is used rather than Math.random: this is a credential, and
 * Math.random is not a cryptographic source. Rejection-free by construction
 * since randomInt handles the modulo bias itself.
 */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
const SYMBOLS = '!@#$%&*?'
const LENGTH = 14

function pick(source) {
  return source[crypto.randomInt(0, source.length)]
}

function generatePassword() {
  // Guarantee the mix Supabase's own strength rules and most policies expect,
  // rather than hoping a random draw happens to include one of each.
  const required = [
    pick('ABCDEFGHJKMNPQRSTUVWXYZ'),
    pick('abcdefghijkmnpqrstuvwxyz'),
    pick('23456789'),
    pick(SYMBOLS),
  ]
  const rest = Array.from({ length: LENGTH - required.length }, () => pick(ALPHABET))
  const chars = [...required, ...rest]

  // Fisher-Yates with a cryptographic source, so the guaranteed characters do
  // not always sit in the same four positions.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1)
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }
  return chars.join('')
}

module.exports = { generatePassword, LENGTH, ALPHABET, SYMBOLS }
