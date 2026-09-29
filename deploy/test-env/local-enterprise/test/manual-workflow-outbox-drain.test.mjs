import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { drainSummary, WORKFLOW_DRAIN_PATH } from '../manual-workflow-outbox-drain.mjs'

const source = readFileSync(new URL('../manual-workflow-outbox-drain.mjs', import.meta.url), 'utf8')

test('the one-shot drain is fixed to loopback, the Workflow app and one path', () => {
  assert.equal(WORKFLOW_DRAIN_PATH, '/api/internal/integration-operations/drain')
  assert.match(source, /schedulerRequestHeaders\(/)
  assert.match(source, /'workflow', requestId/)
  assert.match(source, /fetch\(`http:\/\/127\.0\.0\.1:\$\{profile\.listeners\.workflow\.port\}\/workflow\$\{WORKFLOW_DRAIN_PATH\}`/)
  assert.match(source, /parseArgs\(\{ options: \{ profile: \{ type: 'string' \} \}, strict: true \}\)/)
  assert.doesNotMatch(source, /createHmac|createHash/, 'reuses the Gateway signing implementation')
  // Callback delivery targets Aims, so its deployment must be in the trusted context.
  assert.match(source, /apps: \{ console: tenant\.apps\.console, aims: tenant\.apps\.aims, workflow:/)
})

test('only drain counts are printed', () => {
  const summary = drainSummary(200, { code: 0, data: {
    processed: 1, delivered: 1, failed: 0,
    notifications: { processed: 1, published: 1, skipped: 0, failed: 0 },
    actionable: { processed: 1, delivered: 1, pending: 0, invalid: 0 },
    diagnostics: { secretLike: 'x' },
    checkpointTokenDenied: { drain: 0, processTotal: 0 },
    effects: [{ payload: 'not printed' }]
  } })
  assert.deepEqual(Object.keys(summary).sort(), ['actionable', 'callbacks', 'checkpointTokenDenied', 'notifications', 'status'])
  assert.ok(!JSON.stringify(summary).includes('not printed'))
  assert.ok(!JSON.stringify(summary).includes('secretLike'))
})
