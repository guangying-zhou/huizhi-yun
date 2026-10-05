import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import {
  buildCodocsNotification,
  codocsNotificationIdempotencyKey
} from '../server/utils/codocsNotificationBuilders.ts'

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

const notificationSources = [
  'server/api/issues/index.post.ts',
  'server/api/issues/[id].patch.ts',
  'server/api/dept-shares/[id].patch.ts',
  'server/api/weekly-reports/submit.post.ts',
  'server/api/weekly-reports/remind.post.ts',
  'server/api/info/recommend.post.ts',
  'server/api/documents/[uuid]/dept-shares.post.ts',
  'server/api/documents/[uuid]/shares.post.ts',
  'server/api/documents/[uuid]/notify.post.ts',
  'server/utils/reviewNotify.ts'
] as const

describe('Codocs notification contract', () => {
  test('builder fixes the trusted source and preserves required business identity', () => {
    const notification = buildCodocsNotification({
      touser: 'u2',
      title: '文档共享通知',
      description: '请查阅',
      url: 'https://codocs.test/documents/DOC-1',
      eventType: 'codocs.document.shared',
      category: 'document_share',
      severity: 'info',
      bizType: 'document_share',
      bizId: 19,
      idempotencyKey: codocsNotificationIdempotencyKey('document-shared', 19, 'read'),
      metadata: { documentUuid: 'DOC-1', shareId: 19 }
    })

    assert.equal(notification.sourceAppCode, 'codocs')
    assert.equal(notification.eventType, 'codocs.document.shared')
    assert.equal(notification.category, 'document_share')
    assert.equal(notification.severity, 'info')
    assert.equal(notification.bizType, 'document_share')
    assert.equal(notification.bizId, 19)
    assert.deepEqual(notification.metadata, { documentUuid: 'DOC-1', shareId: 19 })
  })

  test('idempotency keys are stable for retries and distinct for different persistent events', () => {
    const first = codocsNotificationIdempotencyKey('department-share-handled', 81, 'accept')
    const retry = codocsNotificationIdempotencyKey('department-share-handled', 81, 'accept')
    const rejected = codocsNotificationIdempotencyKey('department-share-handled', 81, 'reject')

    assert.equal(first, retry)
    assert.notEqual(first, rejected)
    assert.match(first, /^codocs:department-share-handled:[a-f0-9]{64}$/)
  })

  test('every business sendNotification call is routed through the Codocs builder', () => {
    for (const path of notificationSources) {
      const content = source(path)
      const calls = content.match(/sendNotification\s*\(/g) || []
      const migratedCalls = content.match(/sendNotification\(buildCodocsNotification\(/g) || []
      assert.equal(migratedCalls.length, calls.length, `${path} contains an unmigrated sendNotification call`)
    }
  })

  test('notification keys never use wall-clock or random identities', () => {
    for (const path of notificationSources) {
      const content = source(path)
      assert.doesNotMatch(content, /idempotencyKey:[^\n]*(?:Date\.now|Math\.random|randomUUID)/)
    }
  })
})

describe('Codocs manual notification boundaries', () => {
  test('manual reminders and recommendations require request Idempotency-Key after authorization', () => {
    const weekly = source('server/api/weekly-reports/remind.post.ts')
    const info = source('server/api/info/recommend.post.ts')
    const documentNotify = source('server/api/documents/[uuid]/notify.post.ts')
    const departmentReminder = source('server/api/documents/[uuid]/shares.post.ts')
    const review = source('server/utils/reviewNotify.ts')

    assertBefore(weekly, 'if (!isManager && !isLeader && !isParentManager && !isParentLeader)', 'requireCodocsNotificationRequestKey(event')
    assertBefore(weekly, 'requireCodocsNotificationRequestKey(event', 'sendNotification(buildCodocsNotification(')
    assertBefore(info, 'requirePermission(event, \'info\', \'edit\'', 'requireCodocsNotificationRequestKey(event')
    assertBefore(info, 'requireCodocsNotificationRequestKey(event', 'sendNotification(buildCodocsNotification(')
    assertBefore(documentNotify, 'getCodocsDocumentMetadata(event, uuid', 'requireCodocsNotificationRequestKey(event')
    assertBefore(documentNotify, 'requireCodocsNotificationRequestKey(event', 'sendNotification(buildCodocsNotification(')
    assertBefore(departmentReminder, 'actorUid !== ownerUid', 'requireCodocsNotificationRequestKey(event')
    assert.match(review, /sendReminder\([\s\S]*requestIdempotencyKey: string/)
    assert.match(review, /codocsNotificationIdempotencyKey\([\s\S]*requestIdempotencyKey/)
  })

  test('business mutations commit before best-effort notification delivery', () => {
    const cases = [
      ['server/api/issues/index.post.ts', 'const result = await callCodocsTenantRuntime', 'sendNotification(buildCodocsNotification('],
      ['server/api/issues/[id].patch.ts', 'await callCodocsTenantRuntime(event', 'sendNotification(buildCodocsNotification('],
      ['server/api/dept-shares/[id].patch.ts', 'method: \'PATCH\'', 'await notifyShareSender'],
      ['server/api/weekly-reports/submit.post.ts', 'await updateCodocsDocumentMetadata', 'sendNotification(buildCodocsNotification('],
      ['server/api/documents/[uuid]/dept-shares.post.ts', 'const shareResult = await callCodocsTenantRuntime', 'sendNotification(buildCodocsNotification('],
      ['server/api/documents/[uuid]/shares.post.ts', 'const shareResult = await callCodocsTenantRuntime', 'sendNotification(buildCodocsNotification({\n        touser: targetUid,\n        title: \'文档共享通知\'']
    ] as const

    for (const [path, mutation, notification] of cases) {
      assertBefore(source(path), mutation, notification)
    }

    assert.match(source('server/api/issues/index.post.ts'), /\)\)\.catch\(/)
    assert.match(source('server/api/issues/[id].patch.ts'), /\)\)\.catch\(/)
    assert.match(source('server/utils/reviewNotify.ts'), /catch \(error\)/)
  })
})
