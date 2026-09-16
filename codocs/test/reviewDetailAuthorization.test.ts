import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

function source(relativePath: string) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8')
}

function assertBefore(content: string, first: string, second: string) {
  const firstIndex = content.indexOf(first)
  const secondIndex = content.indexOf(second)
  assert.notEqual(firstIndex, -1, `missing ${first}`)
  assert.notEqual(secondIndex, -1, `missing ${second}`)
  assert.ok(firstIndex < secondIndex, `${first} must appear before ${second}`)
}

describe('Codocs review detail authorization boundary', () => {
  test('dedicated BFF requires login and review view permission before runtime access', () => {
    const content = source('server/api/reviews/[id].get.ts')

    assertBefore(content, 'requireRequestUid(event, \'未登录\')', 'callCodocsTenantRuntime(event')
    assertBefore(content, 'requirePermission(event, \'reviews\', \'view\'', 'callCodocsTenantRuntime(event')
    assert.match(content, /query:\s*\{\s*current_user:\s*uid\s*\}/)
  })

  test('middleware proxy enforces the same permission before forwarding trusted actor context', () => {
    const content = source('server/middleware/tenant-runtime.ts')

    assert.match(content, /\/\^\\\/api\\\/reviews\\\/\\d\+\$\/\.test\(apiPath\) && method === 'GET'/)
    assert.match(content, /requirePermission\(event, 'reviews', 'view', '缺少审阅查看权限'\)/)
    assertBefore(content, 'await requireRuntimeRoutePermission(event, apiPath, method)', 'maybeCallCodocsTenantRuntime<unknown>')
    assertBefore(content, 'const actorUid = getRequestUid(event)', 'maybeCallCodocsTenantRuntime<unknown>')
    assertBefore(content, 'const query = withCurrentUser', 'maybeCallCodocsTenantRuntime<unknown>')
  })

  test('document, archive-path, and publish-request read routes authenticate and rebuild actor context', () => {
    for (const relativePath of [
      'server/api/reviews/by-document/[uuid].get.ts',
      'server/api/reviews/by-oss-path.get.ts',
      'server/api/reviews/publish-requests/[id].get.ts',
      'server/api/reviews/publish-requests/index.get.ts'
    ]) {
      const content = source(relativePath)
      assert.match(content, /requireRequestUid\(event, '未登录'\)/)
      assert.match(content, /requirePermission\(event, 'reviews', 'view'/)
      assert.match(content, /withTrustedCodocsReviewReadContext/)
      assertBefore(content, 'requireRequestUid(event, \'未登录\')', 'const data = await callCodocsTenantRuntime')
      assertBefore(content, 'requirePermission(event, \'reviews\', \'view\'', 'const data = await callCodocsTenantRuntime')
    }
  })

  test('trusted review query context removes browser actor aliases before adding the session actor', () => {
    const content = source('server/utils/reviewReadScope.ts')

    for (const key of ['current_user', 'currentUser', 'operator_uid', 'operatorUid', 'actor_uid', 'actorUid']) {
      assert.match(content, new RegExp(`'${key}'`))
    }
    assert.match(content, /Reflect\.deleteProperty\(result, key\)/)
    assert.match(content, /result\.current_user = actor/)
  })

  test('publish-request GET routes cannot use the generic runtime resource proxy', () => {
    const content = source('server/middleware/tenant-runtime.ts')

    assert.doesNotMatch(content, /prefix: '\/api\/reviews\/publish-requests'/)
    assert.match(content, /apiPath === '\/api\/reviews\/publish-requests' && method === 'GET'/)
  })
})
