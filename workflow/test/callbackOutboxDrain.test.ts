import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const endpoint = readFileSync(
  new URL('../server/api/internal/integration-operations/drain.post.ts', import.meta.url),
  'utf8'
)

test('Workflow durable outboxes have a trusted Tenant Gateway scheduled drain', () => {
  assert.match(endpoint, /requireTenantGatewaySchedulerRequest\(event, 'workflow'\)/)
  assert.match(endpoint, /await drainWorkflowActionableLifecycleOutbox\(event\)/)
  assert.match(endpoint, /await drainWorkflowCallbackOutbox\(event\)/)
  assert.doesNotMatch(endpoint, /readBody|getQuery|Authorization/)
})
