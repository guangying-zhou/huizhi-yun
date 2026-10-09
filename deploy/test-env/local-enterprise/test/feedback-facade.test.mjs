import test from 'node:test'
import assert from 'node:assert/strict'
import { consoleFacadeRoute, allowedConsoleSyncOrigin } from '../console-facade.mjs'
test('feedback administrator facade is a closed transport and preserves origin checks', () => {
  for (const [path, method] of [['/console/admin/feedback', 'GET'], ['/console/api/v1/console/feedback', 'GET'], ['/console/api/v1/console/feedback/F1', 'GET'], ['/console/api/v1/console/feedback-settings', 'PATCH'], ['/console/api/v1/console/feedback/F1/retry', 'POST']]) assert.equal(consoleFacadeRoute(path, method), true)
  for (const [path, method] of [['/console/api/v1/console/feedback/F1/delete', 'POST'], ['/console/api/v1/console/feedback', 'POST'], ['/console/admin/feedback/other', 'GET'], ['/console/api/v1/console/feedback/%2F', 'GET']]) assert.equal(consoleFacadeRoute(path, method), false)
  const path = '/console/api/v1/console/feedback-settings'
  assert.equal(allowedConsoleSyncOrigin(path, 'PATCH', new Headers()), false)
  assert.equal(allowedConsoleSyncOrigin(path, 'PATCH', new Headers({ origin: 'https://evil.example', 'sec-fetch-site': 'same-origin' })), false)
  assert.equal(allowedConsoleSyncOrigin(path, 'PATCH', new Headers({ origin: 'https://hzy0.isme.dev', 'sec-fetch-site': 'same-origin' })), true)
})
