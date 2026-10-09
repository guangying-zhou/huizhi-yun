import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { drainSummary, WORKFLOW_DRAIN_PATH } from '../manual-workflow-outbox-drain.mjs'
import { schedulerRequestHeaders } from '../../../cloudflare/tenant-gateway/src/index.js'

const source = readFileSync(new URL('../manual-workflow-outbox-drain.mjs', import.meta.url), 'utf8')

test('the actual scheduler Headers carry the pinned dial on the wire', async () => {
  const headers = await schedulerRequestHeaders({ HZY_TENANT_GATEWAY_INTERNAL_TOKEN: 'fixture' }, {
    tenantCode: 'C000001', environment: 'test',
    apps: { workflow: { deploymentCode: 'C000001-test-workflow-local' } },
    dataRuntime: { endpoint: 'https://hzy-test-runtime.isme.dev' }
  }, 'hzy0.isme.dev', 'workflow', 'fixture', String(Date.now()), '', WORKFLOW_DRAIN_PATH)
  assert.ok(headers instanceof Headers)
  const statement = source.match(/headers\.set\('x-hzy-local-runtime-dial-url', 'http:\/\/127\.0\.0\.1:18084'\)/)?.[0]
  assert.ok(statement, 'Headers property assignment is not a transmitted header')
  new Function('headers', statement)(headers)
  const request = new Request('http://127.0.0.1:23140/workflow' + WORKFLOW_DRAIN_PATH, { method: 'POST', headers })
  assert.equal(request.headers.get('x-hzy-local-runtime-dial-url'), 'http://127.0.0.1:18084')
})

test('the one-shot drain is fixed to loopback, the Workflow app and one path', () => {
  assert.equal(WORKFLOW_DRAIN_PATH, '/api/internal/integration-operations/drain')
  assert.match(source, /schedulerRequestHeaders\(/)
  assert.match(source, /'workflow', requestId/)
  assert.match(source, /fetch\(`http:\/\/127\.0\.0\.1:\$\{profile\.listeners\.workflow\.port\}\/workflow\$\{WORKFLOW_DRAIN_PATH\}`/)
  assert.match(source, /parseArgs\(\{ options: \{ profile: \{ type: 'string' \} \}, strict: true \}\)/)
  assert.doesNotMatch(source, /createHmac|createHash/, 'reuses the Gateway signing implementation')
  // Both exact callback owners are present; no app-wide fallback binding.
  assert.match(source, /apps: \{ console: tenant\.apps\.console, aims: tenant\.apps\.aims, enterprise: \{ deploymentCode: profile\.identity\.enterpriseDeployment \}, workflow:/)
  assert.match(source, /HZY_ENTERPRISE_ORIGIN: \x60http:\/\/127\.0\.0\.1:\$\{profile\.listeners\.enterprise\.port\}/)
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
