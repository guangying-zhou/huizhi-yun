import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  receivableDueDescriptor, receivableDueMessage, receivableDueNotificationsEnabled,
  requireReceivableDueRuntimePage, resolveReceivableDueRecipient,
  type ReceivableDueCandidate
} from '../server/utils/receivableDueNotificationPolicy.ts'
import { requireAltocReceivableAuthorizationResult, requireAltocReceivableDescriptor } from '../server/utils/receivableNotificationDetailResult.ts'
import { receivablePlanCreateSchema } from '../shared/schemas/entities.ts'

const root = fileURLToPath(new URL('..', import.meta.url))
const candidate: ReceivableDueCandidate = {
  stream: 'receivable_plan_due', phase: 'D7', sourceType: 'receivable_plan', sourceId: 42,
  sourceCode: 'RP-42', sourceName: '首期回款', dueAt: '2026-07-17T00:00:00Z',
  recipientCandidates: ['collector-42'], eventVersion: 'altoc-receivable:v1',
  idempotencyKey: 'altoc-receivable:key', actionableKey: 'altoc:receivable:42:g1'
}

test('receivable due delivery is default-off and direct collection-responsible only', async () => {
  assert.equal(receivableDueNotificationsEnabled(undefined), false)
  assert.equal(receivableDueNotificationsEnabled('true'), true)
  assert.equal(await resolveReceivableDueRecipient(candidate, async uid => ({ uid, status: 'active' })), 'collector-42')
  assert.equal(await resolveReceivableDueRecipient(candidate, async () => ({ uid: 'contract-owner', status: 1 })), null)
  assert.equal(await resolveReceivableDueRecipient({ ...candidate, recipientCandidates: ['@all'] }, async uid => ({ uid, status: 1 })), null)
})

test('receivable descriptor, event identity, and stable code URL are exact', () => {
  assert.deepEqual(receivableDueDescriptor(candidate), { resource: 'receivable_plan', id: 'RP-42' })
  assert.equal(receivableDueMessage(candidate).url, '/altoc/payments/RP-42')
  assert.deepEqual(requireAltocReceivableDescriptor({ resource: 'receivable_plan', id: 'RP-42' }), { resource: 'receivable_plan', id: 'RP-42' })
  assert.deepEqual(requireAltocReceivableAuthorizationResult({ authorized: true, reasonCode: 'allowed', resource: 'receivable_plan', id: 'RP-42' }, { resource: 'receivable_plan', id: 'RP-42' }), { authorized: true, reasonCode: 'allowed', resource: 'receivable_plan', id: 'RP-42' })
  assert.throws(() => requireAltocReceivableDescriptor({ resource: 'receivable_overdue_scan', id: 'RP-42' }))
})

test('runtime contract rejects extra fields, fallback recipients, and unnormalized identity', () => {
  const asOf = '2026-07-10T12:00:00Z'
  const page = { stream: 'receivable_plan_due', asOf, items: [candidate], closures: [], nextCursor: null }
  assert.deepEqual(requireReceivableDueRuntimePage(page, asOf), page)
  for (const invalid of [
    { ...candidate, recipientCandidates: [] },
    { ...candidate, recipientCandidates: ['collector-42', 'contract-owner'] },
    { ...candidate, contractOwnerUid: 'fallback' },
    { ...candidate, recipientCandidates: [' collector-42 '] }
  ]) assert.throws(() => requireReceivableDueRuntimePage({ ...page, items: [invalid] }, asOf))
  assert.equal(requireReceivableDueRuntimePage({ ...page, items: [{ ...candidate, sourceCode: ' RP-42 ' }] }, asOf).items[0]?.sourceCode, 'RP-42')
})

test('old manual overdue scan has no notification side effect and reliable drain is opt-in', () => {
  const scan = readFileSync(`${root}/server/api/v1/payments/scan-overdue.post.ts`, 'utf8')
  const drain = readFileSync(`${root}/server/utils/receivableDueNotificationDrain.ts`, 'utf8')
  const task = readFileSync(`${root}/server/tasks/notifications/receivable-due.ts`, 'utf8')
  const render = readFileSync(`${root}/scripts/render-cloudflare-config.mjs`, 'utf8')
  assert.doesNotMatch(scan, /notifyReceivableOverdueItems|buildReceivableOverdueNotifications/)
  assert.doesNotMatch(`${drain}\n${task}`, /receivable_overdue_scan|contract_owner_user_id|owner_user_id|@all/)
  assert.match(drain, /if \(!isAltocReceivableDueEnabled\(\)\)[\s\S]{0,180}requireAltocReceivableDueRuntimeBinding\(\)/)
  assert.match(drain, /acknowledge-closure/)
  assert.match(render, /HZY_ALTOC_RECEIVABLE_DUE_NOTIFICATIONS_ENABLED/)
  assert.match(render, /HZY_ALTOC_SERVICE_CLIENT_ID/)
})

test('source authorization authenticates before body and delegates purpose actor', () => {
  const route = readFileSync(`${root}/server/api/v1/service/notification-details/authorize.post.ts`, 'utf8')
  const auth = readFileSync(`${root}/server/utils/receivableNotificationDetailAuthorization.ts`, 'utf8')
  assert.ok(route.indexOf('requireAltocServiceAuth') < route.indexOf('readBody(event)'))
  assert.match(route, /altoc:notification-details:authorize/)
  assert.match(route, /auth\.scopes\?\.includes\(requirement\.scope\)/)
  assert.match(auth, /notificationDetailActor/)
})

test('payments UI maintains the dedicated collection responsible field', () => {
  const list = readFileSync(`${root}/app/pages/payments/index.vue`, 'utf8')
  const detail = readFileSync(`${root}/app/pages/payments/[id].vue`, 'utf8')
  assert.match(list, /collection_responsible_uid/)
  assert.match(detail, /collection_responsible_uid/)
  assert.match(detail, /未分配（不通知）/)
  assert.match(detail, /hasPermission\('receivable', 'edit'\)/)
  assert.match(detail, /v-if="canEditReceivable"/)
  assert.doesNotMatch(detail, /collection_responsible_uid\s*\|\|\s*.*owner_user_id/)
})

test('receivable input schema keeps collection responsibility separate from owner', () => {
  const parsed = receivablePlanCreateSchema.parse({
    contract_id: 7,
    plan_name: '首期回款',
    amount: 100,
    planned_invoice_date: '2026-07-10',
    planned_payment_date: '2026-07-17',
    owner_user_id: 'plan-owner',
    collection_responsible_uid: 'collector-42'
  })
  assert.equal(parsed.owner_user_id, 'plan-owner')
  assert.equal(parsed.collection_responsible_uid, 'collector-42')
})
