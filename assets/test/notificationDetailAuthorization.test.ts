import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  requireAssetsNotificationAuthorizationDescriptor,
  requireAssetsNotificationDetailAuthorizationResult
} from '../server/utils/notificationDetailAuthorizationResult.ts'

const root = fileURLToPath(new URL('..', import.meta.url))
const descriptor = { resource: 'asset_item' as const, id: 'AST-042' }
const integrationDescriptor = { resource: 'integration_operation' as const, id: '550e8400-e29b-41d4-a716-446655440070' }

test('Assets notification descriptor is an exact stable source tuple', () => {
  assert.deepEqual(requireAssetsNotificationAuthorizationDescriptor(descriptor), descriptor)
  assert.deepEqual(requireAssetsNotificationAuthorizationDescriptor({
    resource: 'ip_asset', id: 'IP-009'
  }), { resource: 'ip_asset', id: 'IP-009' })
  assert.deepEqual(requireAssetsNotificationAuthorizationDescriptor({
    resource: 'customer_delivery_asset', id: 'CDA-009'
  }), { resource: 'customer_delivery_asset', id: 'CDA-009' })
  assert.deepEqual(requireAssetsNotificationAuthorizationDescriptor({
    resource: 'offboarding_recovery_case', id: 'ORC-009'
  }), { resource: 'offboarding_recovery_case', id: 'ORC-009' })
  assert.deepEqual(requireAssetsNotificationAuthorizationDescriptor(integrationDescriptor), integrationDescriptor)
  assert.throws(() => requireAssetsNotificationAuthorizationDescriptor({ ...descriptor, extra: true }))
  assert.throws(() => requireAssetsNotificationAuthorizationDescriptor({ resource: 'asset', id: 'AST-042' }))
  assert.throws(() => requireAssetsNotificationAuthorizationDescriptor({ ...descriptor, id: 'AST\n042' }))
  assert.throws(() => requireAssetsNotificationAuthorizationDescriptor({ resource: 'integration_operation', id: 'operation-key' }))
})

test('Assets runtime authorization result requires an exact echoed tuple and reason pairing', () => {
  assert.deepEqual(requireAssetsNotificationDetailAuthorizationResult({
    authorized: true,
    reasonCode: 'allowed',
    resource: 'asset_item',
    id: 'AST-042'
  }, descriptor), { authorized: true, reasonCode: 'allowed', ...descriptor })
  assert.deepEqual(requireAssetsNotificationDetailAuthorizationResult({
    authorized: false,
    reasonCode: 'not_authorized',
    resource: 'asset_item',
    id: 'AST-042'
  }, descriptor), { authorized: false, reasonCode: 'not_authorized', ...descriptor })
  assert.throws(() => requireAssetsNotificationDetailAuthorizationResult({
    authorized: true, reasonCode: 'allowed', resource: 'ip_asset', id: 'AST-042'
  }, descriptor))
  assert.deepEqual(requireAssetsNotificationDetailAuthorizationResult({
    authorized: false,
    reasonCode: 'stale_notification',
    resource: 'integration_operation',
    id: integrationDescriptor.id
  }, integrationDescriptor), { authorized: false, reasonCode: 'stale_notification', ...integrationDescriptor })
  assert.throws(() => requireAssetsNotificationDetailAuthorizationResult({
    authorized: false,
    reasonCode: 'not_authorized',
    resource: 'integration_operation',
    id: integrationDescriptor.id
  }, integrationDescriptor))
  assert.throws(() => requireAssetsNotificationDetailAuthorizationResult({
    authorized: false, reasonCode: 'direct_relation_required', resource: 'asset_item', id: 'AST-042'
  }, descriptor))
  assert.throws(() => requireAssetsNotificationDetailAuthorizationResult({
    authorized: true, reasonCode: 'allowed', resource: 'asset_item', id: 'AST-042', evidence: true
  }, descriptor))
})

test('service endpoint is Console-only and delegates a bound notification-detail actor', () => {
  const middleware = readFileSync(`${root}/server/middleware/tenant-runtime.ts`, 'utf8')
  const route = readFileSync(`${root}/server/api/v1/service/notification-details/authorize.post.ts`, 'utf8')
  const authorization = readFileSync(`${root}/server/utils/notificationDetailAuthorization.ts`, 'utf8')
  assert.ok(middleware.indexOf('await ensureAssetsConsoleAuth(event)') < middleware.indexOf('requireForwardedServiceCapability(event)'))
  assert.match(middleware, /suffix === '\/service\/notification-details\/authorize'[\s\S]{0,140}scope: 'assets:notification-details:authorize'[\s\S]{0,100}allowedApps: \['console'\]/)
  assert.match(middleware, /context\.method === 'POST' && context\.suffix === '\/service\/notification-details\/authorize'/)
  assert.match(middleware, /suffix === '\/service\/offboarding-recoveries:upsert'[\s\S]{0,160}scope: 'assets:offboarding-recovery:sync'[\s\S]{0,100}allowedApps: \['people'\]/)
  assert.match(route, /parseNotificationDetailAuthorizationRequest/)
  assert.match(route, /requireNotificationDetailAuthorizationCaller/)
  assert.match(route, /scope:\s*'assets:notification-details:authorize'/)
  assert.ok(route.indexOf('requireNotificationDetailAuthorizationCaller') < route.indexOf('authorizeAssetsNotificationDetail('))
  assert.match(authorization, /'\/v1\/assets\/notification-details\/authorize'/)
  assert.match(authorization, /scope:\s*'assets\.read'/)
  assert.match(authorization, /notificationDetailActor:/)
  assert.match(authorization, /tenantId:\s*actor\.tenantId/)
  assert.match(authorization, /deploymentId:\s*actor\.deploymentId/)
  assert.match(authorization, /requireAssetsNotificationDetailAuthorizationResult/)
})
