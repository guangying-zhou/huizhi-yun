import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

test('share and version BFF routes establish document permissions before runtime forwarding', () => {
  const shareList = source('server/api/documents/[uuid]/shares.get.ts')
  const versionList = source('server/api/documents/[uuid]/versions.get.ts')
  const markRead = source('server/api/documents/[uuid]/read.post.ts')
  const middleware = source('server/middleware/tenant-runtime.ts')

  for (const [route, action] of [[shareList, 'edit'], [versionList, 'view'], [markRead, 'view']] as const) {
    assert.match(route, /requireRequestUid\(event\)/)
    assert.match(route, new RegExp(`requirePermission\\(event,\\s*'documents',\\s*'${action}'`))
    assert.ok(route.indexOf('requireRequestUid(event)') < route.lastIndexOf('callCodocsTenantRuntime'))
  }
  assert.doesNotMatch(markRead, /const \{ uid \} = body/)
  assert.match(markRead, /body: \{\}/)
  assert.match(middleware, /documents\\\/\[\^\/\]\+\\\/shares\$[\s\S]{0,160}method === 'GET'/)
  assert.match(middleware, /documents\\\/\[\^\/\]\+\\\/versions\$[\s\S]{0,160}method === 'GET'/)
})
