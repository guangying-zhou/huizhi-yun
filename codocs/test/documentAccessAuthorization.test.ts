import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

test('document-access BFF routes establish session and permission boundaries before runtime forwarding', () => {
  const checks = [
    ['server/api/document-access/check.post.ts', 'view'],
    ['server/api/document-access/policies/[documentUuid].get.ts', 'admin'],
    ['server/api/document-access/policies/[documentUuid].put.ts', 'admin'],
    ['server/api/document-access/audit-logs.get.ts', 'admin']
  ] as const

  for (const [path, action] of checks) {
    const route = source(path)
    assert.match(route, /requireRequestUid\(event\)/)
    assert.match(route, new RegExp(`requirePermission\\(event,\\s*'documents',\\s*'${action}'`))
    assert.ok(route.indexOf('requireRequestUid(event)') < route.lastIndexOf('callCodocsTenantRuntime'))
    assert.ok(route.indexOf(`'documents', '${action}'`) < route.lastIndexOf('callCodocsTenantRuntime'))
  }

  const middleware = source('server/middleware/tenant-runtime.ts')
  assert.match(middleware, /apiPath === '\/api\/document-access\/check' && method === 'POST'/)
  assert.match(middleware, /document-access\\\/policies\\\/\[\^\/\]\+/)
  assert.match(middleware, /document-access\/audit-logs/)
})
