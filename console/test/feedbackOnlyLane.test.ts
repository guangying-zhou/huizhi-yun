import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

test('feedback-only wake is authenticated before branching and cannot wake adjacent machines', () => {
  const source = readFileSync(new URL('../server/api/internal/integration-operations/drain.post.ts', import.meta.url), 'utf8')
  const auth = source.indexOf('await requireTenantGatewaySchedulerRequest(event, \'console\')')
  const branch = source.indexOf('request?.feedbackOnly === true')
  const lifecycle = source.indexOf('await drainPlatformLifecycleOperationsForEvent')
  assert.ok(auth >= 0 && auth < branch && branch < lifecycle)
  assert.match(source, /Object\.keys\(request\)\.some/)
  assert.match(source, /feedbackDeliveryEnabled !== true/)
  assert.match(source.slice(branch, lifecycle), /request\.phase === 'issue'/)
  assert.match(source.slice(branch, lifecycle), /feedbackTask\(event, 'drain'\)/)
  assert.match(source.slice(branch, lifecycle), /return \{ code: 0/)
})
