import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { requireFinanceNotificationAuthorizationResult, requireFinanceNotificationDescriptor } from '../server/utils/notificationDetailAuthorizationResult.ts'

test('Finance notification descriptor accepts only exact finance or frozen-operation tuples', () => {
  for (const descriptor of [
    { resource: 'invoice_request', id: 'IR-42' },
    { resource: 'finance_receipt', id: 'RCV-42' },
    { resource: 'integration_operation', id: '550e8400-e29b-41d4-a716-446655440099' }
  ] as const) assert.deepEqual(requireFinanceNotificationDescriptor(descriptor), descriptor)
  for (const descriptor of [
    { resource: 'invoice_request', id: 'IR-42', owner: 'forged' },
    { resource: 'receipt', id: 'RCV-42' },
    { resource: 'finance_receipt', id: '' },
    { resource: 'integration_operation', id: '550E8400-E29B-41D4-A716-446655440099' }
  ]) assert.throws(() => requireFinanceNotificationDescriptor(descriptor))
})

test('Finance integration-operation admin uses tenant-global scoped runtime calls', () => {
  const root = fileURLToPath(new URL('..', import.meta.url))
  const helper = readFileSync(`${root}/server/utils/integrationOperationAdmin.ts`, 'utf8')
  const replay = readFileSync(`${root}/server/api/v1/finance/integration-operations/[operationId]/replay.post.ts`, 'utf8')
  const page = readFileSync(`${root}/app/pages/integration-operations.vue`, 'utf8')
  assert.match(helper, /hasTenantGlobalIntegrationOperationGrant/)
  assert.match(helper, /finance:integration_operations:\$\{action\}/)
  assert.match(replay, /expectedVersion.*reason/s)
  assert.match(page, /IntegrationOperationAdminPage/)
  assert.match(page, /api-base="\/api\/v1\/finance\/integration-operations"/)
})

test('Finance authorization result is exact and identity-bound', () => {
  const descriptor = { resource: 'invoice_request', id: 'IR-42' } as const
  assert.deepEqual(requireFinanceNotificationAuthorizationResult({ authorized: true, reasonCode: 'allowed', ...descriptor }, descriptor), { authorized: true, reasonCode: 'allowed', ...descriptor })
  for (const result of [
    { authorized: true, reasonCode: 'not_authorized', ...descriptor },
    { authorized: true, reasonCode: 'allowed', resource: 'invoice_request', id: 'IR-41' },
    { authorized: true, reasonCode: 'allowed', ...descriptor, admin: true }
  ]) assert.throws(() => requireFinanceNotificationAuthorizationResult(result, descriptor))
})

test('Finance service endpoint authenticates before body and delegates a purpose-bound actor', () => {
  const root = fileURLToPath(new URL('..', import.meta.url))
  const route = readFileSync(`${root}/server/api/v1/service/notification-details/authorize.post.ts`, 'utf8')
  const authorization = readFileSync(`${root}/server/utils/notificationDetailAuthorization.ts`, 'utf8')
  assert.ok(route.indexOf('requireFinanceServiceScope') < route.indexOf('readBody(event)'))
  assert.match(route, /finance:notification-details:authorize/)
  assert.match(authorization, /notificationDetailActor/)
  assert.match(authorization, /subjectUid: string, tenantId: string, deploymentId: string/)
  assert.doesNotMatch(`${route}\n${authorization}`.toLowerCase(), /manager|department|@all/)
})
