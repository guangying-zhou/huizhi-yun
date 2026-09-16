import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import {
  decodePendingActionableCursor,
  encodePendingActionableCursor
} from '../server/utils/portalActionableList.ts'

describe('pending actionable safe envelope list', () => {
  test('cursor remains opaque, stable and validated at the Console boundary', () => {
    const cursor = encodePendingActionableCursor('2026-07-10T12:00:00.000Z', 99)
    assert.deepEqual(decodePendingActionableCursor(cursor), {
      v: 1,
      updatedAt: '2026-07-10T12:00:00.000Z',
      id: 99
    })
    assert.doesNotMatch(cursor, /^\d+$/)
    assert.throws(() => decodePendingActionableCursor('not-opaque'))
  })

  test('Runtime query is user-bound, bounded and returns only safe envelope fields', () => {
    const runtime = readFileSync(new URL('../../data-runtime/internal/apps/console/notifications_write.go', import.meta.url), 'utf8')
    const start = runtime.indexOf('func (a *Adapter) UserNotificationTodos')
    const end = runtime.indexOf('func parseCanonicalNotification', start)
    const implementation = runtime.slice(start, end)
    assert.match(implementation, /filters := \[\]string\{"p\.uid=\?"/)
    assert.match(implementation, /p\.state='pending'/)
    assert.match(implementation, /if limit > 100/)
    assert.match(implementation, /"displayLabel": notificationDisplayLabel\(category\)/)
    const projection = implementation.slice(
      implementation.indexOf('SELECT p.id,p.current_notification_id'),
      implementation.indexOf('FROM portal_actionable_projections')
    )
    assert.doesNotMatch(projection, /n\.title|n\.summary|n\.body|n\.action_url|n\.metadata_json|n\.idempotency_key/)
  })

  test('route authenticates user before querying the Runtime list', () => {
    const source = readFileSync(new URL('../server/api/v1/console/notifications/todos/index.get.ts', import.meta.url), 'utf8')
    assert.ok(source.indexOf('const uid = await requireNotificationUserUid(event)') < source.indexOf('data: await listUserPendingActionables'))
  })
})
