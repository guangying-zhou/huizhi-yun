import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('Aims receipt route separates service identity from frozen actor', () => {
  const route = read('server/api/v1/service/service-tickets/[ticketCode]/work-item/receive.post.ts')
  assert.match(route, /aims:service-ticket:work-item:create/)
  assert.match(route, /getHeader\(event, 'x-hzy-actor-uid'\)/)
  assert.doesNotMatch(route, /command\?\.actorUid/)
  assert.match(route, /!actorUid/)
  assert.match(route, /serviceCommandActor:\s*\{ uid: actorUid \}/)
})

test('Aims business mutation runs inside the target receipt transaction', () => {
  const receipt = readFileSync(new URL('../../data-runtime/internal/apps/aims/service_ticket_receipt.go', import.meta.url), 'utf8')
  assert.match(receipt, /repository\.Execute/)
  assert.match(receipt, /createWorkItemFromServiceTicketTx/)
  assert.match(receipt, /TargetBizType:\s*"work_item"/)
})

test('legacy raw service-ticket work-item endpoint is retired fail closed', () => {
  const middleware = read('server/middleware/tenant-runtime.ts')
  const runtime = readFileSync(new URL('../../data-runtime/internal/apps/aims/service_contract_bridge.go', import.meta.url), 'utf8')
  assert.doesNotMatch(middleware, /\/service\/service-tickets\/\[\^\/\]\+\/work-item\$.*aims:write/)
  assert.match(runtime, /legacy_service_ticket_work_item_retired/)
  assert.match(runtime, /http\.StatusGone/)
})
