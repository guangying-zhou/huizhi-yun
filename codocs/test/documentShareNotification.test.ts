import test from 'node:test'
import assert from 'node:assert/strict'
import { documentShareNotificationHint, persistedDocumentShareNotification } from '../app/utils/documentShareNotification.ts'

test('persisted share displays success with a safe notification warning, not failed sharing', () => {
  assert.match(persistedDocumentShareNotification({ data: { data: { sharedPersisted: true, notificationReason: 'wecom_send_error' } } })!, /企业微信通知未送达/)
  assert.equal(persistedDocumentShareNotification({ data: { message: 'private', sharedPersisted: false } }), null)
  assert.doesNotMatch(persistedDocumentShareNotification({ data: { sharedPersisted: true, notificationReason: 'private' } })!, /private/)
  assert.match(documentShareNotificationHint({ notification: { externalStatus: 'skipped', reason: 'external_identity_missing' } }), /未绑定企业微信/)
})
