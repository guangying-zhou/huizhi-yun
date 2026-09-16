import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  financeDueAuthorizationDescriptor,
  financeDueEventType,
  financeDueMessage,
  financeDueNotificationsEnabled,
  requireFinanceDueRuntimePage,
  resolveFinanceDueRecipient,
  type FinanceDueCandidate
} from '../server/utils/dueNotificationPolicy.ts'

const root = fileURLToPath(new URL('..', import.meta.url))
const candidate: FinanceDueCandidate = {
  stream: 'invoice_issuance_due', phase: 'D7', sourceType: 'invoice_request', sourceId: 42,
  sourceCode: 'IR-42', sourceName: '开票申请 IR-42', dueAt: '2026-07-17T12:00:00Z',
  recipientCandidates: ['owner-42'], eventVersion: 'finance-due:v1', idempotencyKey: 'finance-due:key', actionableKey: 'finance:invoice:42:g1'
}

test('Finance due notifications are default-off and use one active direct recipient', async () => {
  assert.equal(financeDueNotificationsEnabled(undefined), false)
  assert.equal(financeDueNotificationsEnabled('false'), false)
  assert.equal(financeDueNotificationsEnabled('true'), true)
  assert.equal(await resolveFinanceDueRecipient(candidate, async uid => ({ uid, status: 'active' })), 'owner-42')
  assert.equal(await resolveFinanceDueRecipient(candidate, async () => ({ uid: 'manager', status: 1 })), null)
  assert.equal(await resolveFinanceDueRecipient({ ...candidate, recipientCandidates: ['@all'] }, async uid => ({ uid, status: 1 })), null)
})

test('Finance due descriptors, event types, and resolvable action URLs are exact', () => {
  assert.deepEqual(financeDueAuthorizationDescriptor(candidate), { resource: 'invoice_request', id: 'IR-42' })
  assert.equal(financeDueEventType(candidate.stream), 'finance.invoice_request.issuance_due')
  assert.equal(financeDueMessage(candidate).url, '/finance/invoices/requests/IR-42')
  const receipt = { ...candidate, stream: 'receipt_reconciliation_due', sourceType: 'finance_receipt', sourceCode: 'RCV-7' } as FinanceDueCandidate
  assert.deepEqual(financeDueAuthorizationDescriptor(receipt), { resource: 'finance_receipt', id: 'RCV-7' })
  assert.equal(financeDueEventType(receipt.stream), 'finance.receipt.reconciliation_due')
  assert.equal(financeDueMessage(receipt).url, '/finance/receipts/RCV-7')
})

test('runtime pages reject fallback recipients and source drift', () => {
  const asOf = '2026-07-10T12:00:00Z'
  const page = { stream: candidate.stream, asOf, items: [candidate], closures: [], nextCursor: null }
  assert.deepEqual(requireFinanceDueRuntimePage(page, candidate.stream, asOf), page)
  for (const invalid of [
    { ...candidate, recipientCandidates: [] },
    { ...candidate, recipientCandidates: ['owner-42', 'manager'] },
    { ...candidate, recipientCandidates: ['@all'] },
    { ...candidate, sourceType: 'finance_receipt' },
    { ...candidate, managerUid: 'manager' }
  ]) assert.throws(() => requireFinanceDueRuntimePage({ ...page, items: [invalid] }, candidate.stream, asOf))
})

test('scheduled drain is bounded, reliable, and Cloudflare cron is opt-in', () => {
  const drain = readFileSync(`${root}/server/utils/dueNotificationDrain.ts`, 'utf8')
  const scheduledRuntime = readFileSync(`${root}/server/utils/scheduledRuntime.ts`, 'utf8')
  const task = readFileSync(`${root}/server/tasks/notifications/finance-due.ts`, 'utf8')
  const config = readFileSync(`${root}/nuxt.config.ts`, 'utf8')
  const render = readFileSync(`${root}/scripts/render-cloudflare-config.mjs`, 'utf8')
  assert.match(drain, /if \(!isFinanceDueNotificationDeliveryEnabled\(\)\)[\s\S]{0,180}requireFinanceDueNotificationRuntimeBinding\(\)/)
  assert.match(drain, /authorizationDescriptor:\s*descriptor/)
  assert.match(drain, /acknowledge-closure/)
  assert.match(task, /maxWallTimeMs:\s*45_000/)
  assert.match(config, /'\*\/15 \* \* \* \*': \['notifications:finance-due', 'integration-operations:finance-altoc-summary'\]/)
  assert.match(render, /const dueNotificationsEnabled = enabled\('HZY_FINANCE_DUE_NOTIFICATIONS_ENABLED'\)/)
  assert.match(render, /!dueNotificationsEnabled && !enabled\('HZY_FINANCE_INTEGRATION_OPERATIONS_ENABLED'\)/)
  assert.match(render, /Finance due notifications require explicit binding vars/)
  assert.match(render, /HZY_FINANCE_SERVICE_CLIENT_ID=finance\.runtime/)
  assert.match(scheduledRuntime, /HZY_FINANCE_SERVICE_CLIENT_SECRET/)
  assert.match(scheduledRuntime, /financeDueNotificationWorkerScope = 'finance\.notifications_due\.execute'/)
  assert.match(scheduledRuntime, /finance\.scheduled-notification-worker/)
  assert.match(scheduledRuntime, /finance-due-notification-worker/)
  assert.match(scheduledRuntime, /short-lived finance\.runtime service token, not a static runtime token/)
  assert.match(scheduledRuntime, /dedicated finance\.runtime service client/)
  assert.match(drain, /callFinanceDueNotificationRuntime/)
  assert.doesNotMatch(drain, /scope:\s*'finance\.write'/)
  assert.doesNotMatch(`${drain}\n${scheduledRuntime}\n${task}\n${render}`.toLowerCase(), /gitlab-runner|\.gitlab-ci/)
})

test('due worker Console grant is narrow, repeatable, and does not create credentials', () => {
  const seed = readFileSync(`${root}/../console/docs/sql/Console-SQL-Seed-v1.48-finance-due-notification-worker-grant.sql`, 'utf8')
  const verify = readFileSync(`${root}/../console/docs/sql/Console-SQL-Verify-v1.48-finance-due-notification-worker-grant.sql`, 'utf8')
  assert.match(seed, /client_code` = 'finance\.runtime'/)
  assert.match(seed, /data-runtime:finance:notifications_due/)
  assert.match(seed, /'execute'/)
  assert.match(seed, /finance-due-notification-worker/)
  assert.match(seed, /ON DUPLICATE KEY UPDATE/)
  assert.doesNotMatch(seed, /INSERT\s+INTO\s+`?service_client_credentials`?/i)
  assert.doesNotMatch(seed, /INSERT\s+INTO\s+`?vault_secret_versions`?/i)
  assert.match(verify, /has_finance_due_notification_worker_grant/)
})
