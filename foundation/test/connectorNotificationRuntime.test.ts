import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const notify = readFileSync(new URL('../server/utils/notify.ts', import.meta.url), 'utf8')

test('external notifications switch to Connector Runtime only through an explicit setting', () => {
  assert.match(notify, /connector\.notificationsEnabled/)
  assert.match(notify, /connectorEnabledEnv === 'true'/)
  assert.match(notify, /connectorEnabledSetting === true/)
  assert.match(notify, /audience: 'connector-runtime'/)
  assert.match(notify, /scope: 'connector-runtime:notifications:send'/)
  assert.match(notify, /connector\.runtimeApiUrl/)
})

test('legacy Notification Runtime remains the fallback contract', () => {
  assert.match(notify, /runtimeUrl: await resolveNotificationRuntimeUrl/)
  assert.match(notify, /scope: 'notification-runtime:send'/)
  assert.match(notify, /resolveNotificationRuntimeToken/)
})
