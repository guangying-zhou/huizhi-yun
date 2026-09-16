import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

test('Foundation platform activation retry requires runtime admin permission after activation', () => {
  const content = source('server/api/platform-activation/retry.post.ts')

  assert.match(content, /loadPlatformActivationStatus/)
  assert.match(content, /loadAuthorizationSnapshotFromConsoleRuntime\(uid,\s*'console',\s*event\)/)
  assert.match(content, /snapshot\.resources\.system_settings/)
  assert.match(content, /actions\.includes\('admin'\)/)
  assert.match(content, /if \(status\.activated\) \{\s*await requireActivatedPlatformRetryPermission\(event\)\s*\}/)

  const permissionIndex = content.indexOf('await requireActivatedPlatformRetryPermission(event)')
  const refreshIndex = content.indexOf('refreshPlatformPolicyBundle(\'manual-retry\')')
  assert.ok(permissionIndex >= 0, 'retry endpoint must check permission when activated')
  assert.ok(refreshIndex >= 0, 'retry endpoint must refresh platform policy bundle')
  assert.ok(permissionIndex < refreshIndex, 'permission check must run before manual bundle refresh')
})
