/**
 * Core AI Assistant logic — conversational Q&A grounded strictly in a
 * compact financial data snapshot the frontend computes and sends
 * (P&L/Balance Sheet/Cash Flow summaries, receivables, top customers),
 * never raw transaction narrations. Two reasons for that boundary:
 * 1. Bank narrations are semi-trusted external text (whatever the
 *    payer/payee's bank put on the statement) — including them
 *    verbatim in an LLM prompt would open a prompt-injection surface
 *    this feature doesn't need, since aggregated numbers and a fixed
 *    48-category taxonomy carry no attacker-controlled instructions.
 * 2. It keeps the snapshot small regardless of transaction volume.
 *
 * Separated from the Express route so prompt-building/validation can
 * be unit-tested without a real API key or network call, same as
 * categorisationEngine.js.
 */

const { z } = require('zod')

const MAX_QUESTION_LENGTH = 500
const MAX_HISTORY_TURNS = 20
const MAX_HISTORY_CONTENT_LENGTH = 2000
const MAX_SNAPSHOT_JSON_LENGTH = 20000
// Safety cap on what's returned to the client, in case the model
// ignores the "be concise" instruction — not expected to bind in
// practice, just a bound on worst-case response size.
const MAX_ANSWER_LENGTH = 4000

const HistoryTurnSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().max(MAX_HISTORY_CONTENT_LENGTH, `A conversation turn is too long (max ${MAX_HISTORY_CONTENT_LENGTH} characters).`),
})

const AssistantRequestSchema = z.object({
  question: z
    .string()
    .min(1, 'Question is required.')
    .max(MAX_QUESTION_LENGTH, `Question is too long (max ${MAX_QUESTION_LENGTH} characters).`),
  snapshot: z.record(z.any()).optional().default({}),
  history: z
    .array(HistoryTurnSchema)
    .max(MAX_HISTORY_TURNS, `Too much conversation history (max ${MAX_HISTORY_TURNS} turns) — start a new conversation.`)
    .optional()
    .default([]),
})

function validateAssistantRequest(body) {
  const parsed = AssistantRequestSchema.safeParse(body)
  if (!parsed.success) {
    return { valid: false, error: parsed.error.issues[0]?.message || 'Invalid request.' }
  }
  const snapshotJson = JSON.stringify(parsed.data.snapshot || {})
  if (snapshotJson.length > MAX_SNAPSHOT_JSON_LENGTH) {
    return { valid: false, error: 'Financial snapshot is too large.' }
  }
  return { valid: true, data: parsed.data }
}

function buildSystemPrompt(snapshot) {
  return `You are the NEXUS Financial Assistant, built into a bookkeeping app for Nigerian small businesses. You answer questions about THIS business's own financial data — nothing else.

Rules:
1. Answer ONLY using the JSON financial snapshot below. Never invent numbers, transactions, customers, or categories that aren't in it.
2. If the snapshot doesn't have enough information to answer, say so plainly, and suggest where in NEXUS they might find it (e.g. "the Reports → Income/Expense Analysis tab" or "the Sales → Customers page").
3. You are not a licensed accountant or tax adviser. Frame VAT/CIT/tax statements as general guidance ("this is typically...", "you may want to confirm with your accountant"), never as a definitive ruling.
4. Be concise — a few sentences by default, more only if the user asks for detail.
5. All amounts are in Nigerian Naira. Use the figures exactly as given; don't recompute totals or invent percentages not already in the data.
6. You cannot take actions in the app (create invoices, categorise transactions, change settings) — you can only answer questions about the data you're given.

Financial snapshot (JSON):
${JSON.stringify(snapshot)}`
}

function buildMessages(history, question) {
  const turns = (history || []).map((h) => ({ role: h.role, content: h.content }))
  return [...turns, { role: 'user', content: question }]
}

/**
 * `aiCall` is provider.call from lib/aiProvider.js — same shape as
 * categorisationEngine.js's dependency injection, so this is
 * unit-testable with a mock instead of a real API key.
 */
async function askAssistant({ question, snapshot, history }, aiCall) {
  const system = buildSystemPrompt(snapshot || {})
  const messages = buildMessages(history, question)
  const raw = await aiCall(null, { system, messages })
  const answer = (raw || '').trim().slice(0, MAX_ANSWER_LENGTH)
  if (!answer) throw new Error('The assistant did not return an answer.')
  return answer
}

module.exports = {
  validateAssistantRequest,
  buildSystemPrompt,
  buildMessages,
  askAssistant,
  MAX_QUESTION_LENGTH,
  MAX_HISTORY_TURNS,
  MAX_HISTORY_CONTENT_LENGTH,
  MAX_SNAPSHOT_JSON_LENGTH,
  MAX_ANSWER_LENGTH,
}
