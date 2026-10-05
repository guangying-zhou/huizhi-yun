import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('user route freezes a trusted source operation and returns pending as 202', () => {
  const route = read('server/api/v1/service-tickets/[ticketCode]/aims-work-item.post.ts')
  assert.match(route, /aims-work-item:freeze/)
  assert.match(route, /claimOpsKnowledgeOperation/)
  assert.match(route, /delivery\.failed \? 409 : 202/)
  assert.match(route, /\['failed_permanent', 'dead_letter'\]\.includes\(frozenStatus\)/)
  assert.match(route, /integration_operation_permanent_failure/)
  assert.doesNotMatch(route, /\|\| 'system'|serviceTicketPayload|\/work-item['"]/)
})

test('executor fixes target capability/path and delegates only the frozen actor', () => {
  const executor = read('server/utils/serviceTicketAimsOperation.ts')
  assert.match(executor, /aims:service-ticket:work-item:create/)
  assert.match(executor, /\/work-item\/receive/)
  assert.match(executor, /text\(operation\.originalActorUid\)/)
  assert.doesNotMatch(executor, /command\.actorUid/)
  assert.match(executor, /aims-work-item:complete/)
})

test('drain explicitly dispatches known operation codes and isolates unknown codes', () => {
  const drain = read('server/utils/integrationOperationDrain.ts')
  assert.match(drain, /unsupported_integration_operation/)
  assert.match(drain, /integration operation item isolated/)
  assert.doesNotMatch(drain, /:\s*await executeClaimedOpsKnowledgeOperation\(operation, io\)/)
})
