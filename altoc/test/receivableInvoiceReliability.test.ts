import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('contract invoice route is a fail-closed tombstone', () => {
  const route = read('server/api/v1/contracts/[id]/invoice-request.post.ts')
  assert.match(route, /statusCode:\s*410/)
  assert.doesNotMatch(route, /requestServiceAccessToken|\/finance\/invoice-requests|Date\.now/)
})

test('receivable invoice route freezes then claims the durable operation', () => {
  const route = read('server/api/v1/receivable-plans/[code]/invoice-request.post.ts')
  assert.match(route, /invoice-request:prepare/)
  assert.match(route, /claimOpsKnowledgeOperation/)
  assert.match(route, /executeReceivableInvoiceOperation/)
  assert.match(route, /setResponseStatus\(event, delivery\.succeeded \? 200 : 202\)/)
  assert.doesNotMatch(route, /authorization|cookie|\/finance\/invoice-requests['"]/)
})

test('contract detail only exposes the receivable-plan invoice action', () => {
  const page = read('app/pages/contracts/[id].vue')

  assert.doesNotMatch(page, /contractInvoiceRequest/)
  assert.doesNotMatch(page, /\/api\/v1\/contracts\/\$\{id\.value\}\/invoice-request/)
  assert.match(page, /async function requestInvoiceForPlan\(plan: ContractReceivablePlan\)/)
  assert.match(page, /\/api\/v1\/receivable-plans\/\$\{encodeURIComponent\(plan\.code\)\}\/invoice-request/)
  assert.match(page, /canRequestInvoiceForPlan\(row\.original\)/)
})

test('executor uses exact Finance capability and delegated frozen actor', () => {
  const executor = read('server/utils/receivableInvoiceOperation.ts')
  assert.match(executor, /finance:invoice-request:create/)
  assert.match(executor, /text\(command\.actorUid\)/)
  assert.match(executor, /validateServiceCommandReceipt/)
})
