import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

test('verified notification users are bound before the Console Runtime call', () => {
  const source = readFileSync(
    new URL('../server/utils/notifications.ts', import.meta.url),
    'utf8'
  )

  assert.match(source, /function bindVerifiedNotificationUser/)
  assert.match(source, /event\.context\.consoleAuth = \{/)
  assert.match(source, /subjectType: 'user'/)
  assert.match(source, /bindVerifiedNotificationUser\(event, uid, token\)/)
  assert.match(source, /bindVerifiedNotificationUser\(event, session\.uid\)/)
})
