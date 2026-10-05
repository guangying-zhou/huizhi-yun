import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import {
  buildLeadAssignmentNotification,
  buildOpportunityAssignmentNotification,
  buildOpportunityStaleNotifications,
  currentUtcScanPeriod,
  deliverNotificationsBestEffort,
  MissingAssignmentEventVersionError,
  type OpportunityStaleNotice
} from '../server/utils/runtimeNotificationBuilders.ts'

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

function assertBefore(content: string, left: string, right: string): void {
  const leftIndex = content.indexOf(left)
  const rightIndex = content.indexOf(right)
  assert.notEqual(leftIndex, -1, `Missing ${left}`)
  assert.notEqual(rightIndex, -1, `Missing ${right}`)
  assert.ok(leftIndex < rightIndex, `${left} must appear before ${right}`)
}

describe('Altoc assignment notification builders', () => {
  test('lead assignment retries share a key while a new event version gets a new key', () => {
    const lead = {
      id: 42,
      code: 'L-42',
      name: '海上项目线索',
      owner_user_id: 'owner-2'
    }
    const first = buildLeadAssignmentNotification(lead, 'owner-1', 'https://altoc.test/leads/42', 'event-7')
    const retry = buildLeadAssignmentNotification(lead, 'owner-1', 'https://altoc.test/leads/42', 'event-7')
    const reassigned = buildLeadAssignmentNotification(lead, 'owner-1', 'https://altoc.test/leads/42', 'event-8')

    assert.ok(first)
    assert.ok(retry)
    assert.ok(reassigned)
    assert.equal(first.idempotencyKey, retry.idempotencyKey)
    assert.notEqual(first.idempotencyKey, reassigned.idempotencyKey)
    assert.equal(first.sourceAppCode, 'altoc')
    assert.equal(first.eventType, 'altoc.lead.assigned')
    assert.equal(first.category, 'assignment')
    assert.equal(first.bizType, 'lead')
    assert.equal(first.bizId, 42)
    assert.deepEqual(first.metadata, {
      notificationKind: 'assignment',
      entityType: 'lead',
      entityId: 42,
      entityCode: 'L-42',
      assigneeUid: 'owner-2',
      assignerUid: 'owner-1',
      eventVersion: 'event-7'
    })
  })

  test('opportunity assignment carries the unified notification contract', () => {
    const notification = buildOpportunityAssignmentNotification({
      id: 81,
      code: 'OP-81',
      name: '设备采购商机',
      owner_user_id: 'sales-2',
      customer_name: '远航公司',
      amount_tax_inclusive: 120000
    }, 'sales-1', 'https://altoc.test/opportunities/81', 'audit-991')

    assert.ok(notification)
    assert.equal(notification.sourceAppCode, 'altoc')
    assert.equal(notification.eventType, 'altoc.opportunity.assigned')
    assert.equal(notification.category, 'assignment')
    assert.equal(notification.severity, 'info')
    assert.equal(notification.bizType, 'opportunity')
    assert.equal(notification.bizId, 81)
    assert.equal(notification.metadata?.eventVersion, 'audit-991')
  })

  test('missing a stable event version fails explicitly instead of using a timestamp fallback', () => {
    assert.throws(() => buildLeadAssignmentNotification({
      id: 43,
      name: '缺版本线索',
      owner_user_id: 'owner-2'
    }, 'owner-1', 'https://altoc.test/leads/43'), MissingAssignmentEventVersionError)
  })
})

describe('Altoc scan notification builders', () => {
  test('stale scan sorts owners and item ids before deriving its key and preview', () => {
    const rows: OpportunityStaleNotice[] = [
      { id: 9, code: 'OP-9', name: '九号', owner_user_id: 'owner-b', days_stale: 9 },
      { id: 7, code: 'OP-7', name: '七号', owner_user_id: 'owner-a', days_stale: 7 },
      { id: 2, code: 'OP-2', name: '二号', owner_user_id: 'owner-a', days_stale: 12 }
    ]

    const first = buildOpportunityStaleNotifications(rows, '2026-07-10', 'https://altoc.test/opportunities')
    const reordered = buildOpportunityStaleNotifications(
      [rows[2]!, rows[0]!, rows[1]!],
      '2026-07-10',
      'https://altoc.test/opportunities'
    )

    assert.deepEqual(first, reordered)
    assert.equal(first[0]?.eventType, 'altoc.opportunity.stale')
    assert.equal(first[0]?.bizType, 'opportunity_stale_scan')
    assert.deepEqual(first[0]?.metadata?.itemIds, [2, 7])
  })

  test('scan periods use a stable UTC calendar day', () => {
    assert.equal(currentUtcScanPeriod(new Date('2026-07-10T23:59:59.000Z')), '2026-07-10')
  })
})

describe('Altoc notification failure boundary', () => {
  test('delivery failures are counted and do not reject the caller', async () => {
    const notifications = buildOpportunityStaleNotifications([
      { id: 1, code: 'OP-1', name: '一号', owner_user_id: 'owner-a', days_stale: 8 },
      { id: 2, code: 'OP-2', name: '二号', owner_user_id: 'owner-b', days_stale: 9 }
    ], '2026-07-10', 'https://altoc.test/opportunities')
    const failures: unknown[] = []

    const delivered = await deliverNotificationsBestEffort(notifications, {
      send: async (params) => {
        if (params.touser === 'owner-a') throw new Error('notification runtime unavailable')
        return { ok: true }
      },
      onError: error => failures.push(error)
    })

    assert.equal(delivered, 1)
    assert.equal(failures.length, 1)
  })

  test('all business mutations complete before best-effort notification orchestration', () => {
    const cases = [
      ['server/api/v1/leads/[id]/assign.post.ts', 'const result = await callAltocRuntime', 'await notifyLeadAssignedItem'],
      ['server/api/v1/leads/index.post.ts', 'const result = await callAltocRuntime', 'await notifyLeadAssignedItem'],
      ['server/api/v1/opportunities/[id]/assign.post.ts', 'const result = await callAltocRuntime', 'await notifyOpportunityAssignedItem'],
      ['server/api/v1/opportunities/index.post.ts', 'const result = await callAltocRuntime', 'await notifyOpportunityAssignedItem'],
      ['server/api/v1/opportunities/scan-stale.post.ts', 'const result = await callAltocRuntime', 'await notifyOpportunityStaleItems'],
      ['server/tasks/stale/scan.ts', 'const result = await callAltocScheduledRuntime', 'await notifyOpportunityStaleItems']
    ] as const

    for (const [path, mutation, notification] of cases) {
      assertBefore(source(path), mutation, notification)
    }
    assert.doesNotMatch(source('server/api/v1/payments/scan-overdue.post.ts'), /notifyReceivableOverdueItems/)
    assert.doesNotMatch(source('server/tasks/overdue/scan.ts'), /notifyReceivableOverdueItems/)
  })

  test('assignment endpoints prefer a stable runtime version or request idempotency key', () => {
    const assignmentPaths = [
      'server/api/v1/leads/[id]/assign.post.ts',
      'server/api/v1/opportunities/[id]/assign.post.ts'
    ]
    const creationPaths = [
      'server/api/v1/leads/index.post.ts',
      'server/api/v1/opportunities/index.post.ts'
    ]

    for (const path of [...assignmentPaths, ...creationPaths]) {
      const content = source(path)
      assert.match(content, /result\.notification_event_version/)
      assert.match(content, /getHeader\(event, 'idempotency-key'\)/)
      assert.doesNotMatch(content, /updated_at|updatedAt/)
    }
    for (const path of creationPaths) {
      assert.match(source(path), /`created:\$\{/)
    }
  })
})
