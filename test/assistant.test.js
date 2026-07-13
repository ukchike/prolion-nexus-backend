const {
  validateAssistantRequest, buildSystemPrompt, buildMessages, askAssistant,
  MAX_QUESTION_LENGTH, MAX_HISTORY_TURNS, MAX_HISTORY_CONTENT_LENGTH, MAX_SNAPSHOT_JSON_LENGTH,
} = require('../src/lib/assistantEngine')

let failures = 0
function check(label, condition) {
  console.log(`  ${condition ? 'PASS' : 'FAIL'} - ${label}`)
  if (!condition) failures++
}

const SAMPLE_SNAPSHOT = {
  businessName: 'Acme Test Ventures',
  periodLabel: 'July 2026',
  financials: { income: 350000, operating: 95000, netPosition: 255000, grossMarginPct: 100 },
}

function testValidation() {
  console.log('\n--- validateAssistantRequest ---')

  const minimal = validateAssistantRequest({ question: 'How much did I spend on rent?' })
  check('accepts a minimal request (no snapshot/history)', minimal.valid === true)
  check('defaults snapshot to {} when omitted', JSON.stringify(minimal.data.snapshot) === '{}')
  check('defaults history to [] when omitted', Array.isArray(minimal.data.history) && minimal.data.history.length === 0)

  const full = validateAssistantRequest({
    question: 'What is my gross margin?',
    snapshot: SAMPLE_SNAPSHOT,
    history: [{ role: 'user', content: 'Hi' }, { role: 'assistant', content: 'Hello, how can I help?' }],
  })
  check('accepts a full request with snapshot + history', full.valid === true)

  check('rejects missing question', validateAssistantRequest({}).valid === false)
  check('rejects empty question', validateAssistantRequest({ question: '' }).valid === false)
  check(
    'rejects a question over the length cap',
    validateAssistantRequest({ question: 'x'.repeat(MAX_QUESTION_LENGTH + 1) }).valid === false
  )
  check(
    'accepts a question exactly at the length cap',
    validateAssistantRequest({ question: 'x'.repeat(MAX_QUESTION_LENGTH) }).valid === true
  )

  check(
    'rejects an invalid history role',
    validateAssistantRequest({ question: 'q', history: [{ role: 'system', content: 'x' }] }).valid === false
  )
  check(
    'rejects a history turn over the content length cap',
    validateAssistantRequest({ question: 'q', history: [{ role: 'user', content: 'x'.repeat(MAX_HISTORY_CONTENT_LENGTH + 1) }] }).valid === false
  )
  check(
    'rejects too many history turns',
    validateAssistantRequest({
      question: 'q',
      history: Array.from({ length: MAX_HISTORY_TURNS + 1 }, () => ({ role: 'user', content: 'x' })),
    }).valid === false
  )
  check(
    'accepts exactly MAX_HISTORY_TURNS turns',
    validateAssistantRequest({
      question: 'q',
      history: Array.from({ length: MAX_HISTORY_TURNS }, () => ({ role: 'user', content: 'x' })),
    }).valid === true
  )

  const hugeSnapshot = { blob: 'x'.repeat(MAX_SNAPSHOT_JSON_LENGTH) }
  check('rejects an oversized snapshot', validateAssistantRequest({ question: 'q', snapshot: hugeSnapshot }).valid === false)
}

function testPromptBuilding() {
  console.log('\n--- buildSystemPrompt / buildMessages ---')

  const system = buildSystemPrompt(SAMPLE_SNAPSHOT)
  check('system prompt embeds the snapshot JSON', system.includes('"income":350000'))
  check('system prompt instructs grounding-only answers', system.toLowerCase().includes('only using the json financial snapshot'))
  check('system prompt disclaims tax/legal authority', system.toLowerCase().includes('not a licensed accountant'))
  check('system prompt forbids claiming to take actions', system.toLowerCase().includes('cannot take actions'))

  const noHistory = buildMessages([], 'How much did I make this month?')
  check('buildMessages with no history returns just the question', noHistory.length === 1 && noHistory[0].role === 'user')

  const withHistory = buildMessages(
    [{ role: 'user', content: 'Hi' }, { role: 'assistant', content: 'Hello' }],
    'And expenses?'
  )
  check('buildMessages appends prior turns before the new question', withHistory.length === 3 && withHistory[2].content === 'And expenses?')
  check('buildMessages preserves turn order/roles', withHistory[0].role === 'user' && withHistory[1].role === 'assistant')
}

async function testAskAssistant() {
  console.log('\n--- askAssistant ---')

  let capturedArgs = null
  const mockAiCall = async (prompt, options) => {
    capturedArgs = { prompt, options }
    return '  Your net position this month is NGN 255,000.  '
  }

  const answer = await askAssistant({ question: 'How am I doing?', snapshot: SAMPLE_SNAPSHOT, history: [] }, mockAiCall)
  check('returns the trimmed answer text', answer === 'Your net position this month is NGN 255,000.')
  check('calls aiCall with a system prompt and messages, prompt arg unused', capturedArgs.prompt === null && typeof capturedArgs.options.system === 'string')
  check('the messages array ends with the actual question', capturedArgs.options.messages[capturedArgs.options.messages.length - 1].content === 'How am I doing?')

  let threw = false
  try {
    await askAssistant({ question: 'q', snapshot: {}, history: [] }, async () => '   ')
  } catch (err) {
    threw = true
    check('empty-answer error message is clear', err.message.includes('did not return an answer'))
  }
  check('throws when the AI returns only whitespace', threw)
}

async function main() {
  testValidation()
  testPromptBuilding()
  await testAskAssistant()
  console.log('\n=================================')
  console.log(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`)
  process.exit(failures === 0 ? 0 : 1)
}

main()
