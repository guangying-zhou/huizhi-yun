import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import {
  CODOCS_TRUSTED_DEPARTMENT_READ_QUERY_KEY,
  withTrustedCodocsDocumentReadContext
} from '../server/utils/documentReadScope.ts'

const root = new URL('..', import.meta.url)

function source(path: string) {
  return readFileSync(new URL(path, root), 'utf8')
}

describe('Codocs document list runtime read scope', () => {
  test('replaces browser-supplied actor and trusted-department fields while retaining ordinary narrowing filters', () => {
    const query = withTrustedCodocsDocumentReadContext({
      owner: 'victim',
      type: 'shared',
      current_user: 'victim',
      actorUid: 'victim',
      [CODOCS_TRUSTED_DEPARTMENT_READ_QUERY_KEY]: 'EVIL'
    }, 'viewer', 'D1')

    assert.equal(query.owner, 'victim')
    assert.equal(query.type, 'shared')
    assert.equal(query.current_user, 'viewer')
    assert.equal(query.currentUser, 'viewer')
    assert.equal(query.actorUid, 'viewer')
    assert.equal(query[CODOCS_TRUSTED_DEPARTMENT_READ_QUERY_KEY], 'D1')
  })

  test('does not forward a browser-supplied department trust marker without an approved department', () => {
    const query = withTrustedCodocsDocumentReadContext({
      [CODOCS_TRUSTED_DEPARTMENT_READ_QUERY_KEY]: 'EVIL'
    }, 'viewer')

    assert.equal(query[CODOCS_TRUSTED_DEPARTMENT_READ_QUERY_KEY], undefined)
  })

  test('requires a verified actor before it can build a runtime read query', () => {
    assert.throws(
      () => withTrustedCodocsDocumentReadContext({}, ''),
      /trusted document read actor is required/
    )
  })

  test('middleware and direct BFF routes require user permission and use the sanitized runtime context', () => {
    const middleware = source('server/middleware/tenant-runtime.ts')
    const listRoute = source('server/api/documents/index.get.ts')
    const trashRoute = source('server/api/documents/trash.get.ts')

    assert.match(middleware, /isDocumentListOrTrashRoute\(apiPath, method\)/)
    assert.match(middleware, /const actorUid = requireRequestUid\(event\)/)
    assert.match(middleware, /requirePermission\(event, 'documents', 'view'/)
    assert.match(middleware, /requireDepartmentReadAccess\(event, actorUid, deptCode\)/)
    assert.match(middleware, /withTrustedCodocsDocumentReadContext\(input, actorUid, deptCode\)/)

    for (const route of [listRoute, trashRoute]) {
      assert.match(route, /requireRequestUid\(event\)/)
      assert.match(route, /requirePermission\(event, 'documents', 'view'/)
      assert.match(route, /withTrustedCodocsDocumentReadContext/)
    }
  })

  test('direct list and trash routes preserve authorization HTTP errors before any runtime call', () => {
    const routes = [
      source('server/api/documents/index.get.ts'),
      source('server/api/documents/trash.get.ts')
    ]

    for (const route of routes) {
      const runtimeCall = route.lastIndexOf('callCodocsTenantRuntime')
      assert.notEqual(runtimeCall, -1)
      assert.ok(route.indexOf('requireRequestUid(event)') < runtimeCall, 'missing actor must stop before runtime')
      assert.ok(route.indexOf('requirePermission(event, \'documents\', \'view\'') < runtimeCall, 'missing documents:view must stop before runtime')
      assert.match(route, /typeof error\.statusCode === 'number' && error\.statusCode >= 400 && error\.statusCode < 600/)
      assert.ok(route.indexOf('throw err') < route.indexOf('statusCode: 500'), 'H3 401/403 must be rethrown before the 500 fallback')
    }

    const listRoute = routes[0]
    const trashRoute = routes[1]
    for (const route of [listRoute, trashRoute]) {
      assert.ok(route.indexOf('requireDepartmentReadAccess') < route.lastIndexOf('callCodocsTenantRuntime'), 'unauthorized department must stop before runtime')
    }
  })

  test('folder list uses the same signed actor and exact department context before runtime forwarding', () => {
    const middleware = source('server/middleware/tenant-runtime.ts')
    const route = source('server/api/folders/index.get.ts')

    assert.match(middleware, /function isFolderListRoute/)
    assert.match(middleware, /folderReadRuntimeQuery/)
    assert.match(middleware, /缺少文档目录查看权限/)
    assert.match(route, /const actorUid = requireRequestUid\(event\)/)
    assert.match(route, /requirePermission\(event, 'documents', 'view', '缺少文档目录查看权限'\)/)
    assert.match(route, /withTrustedCodocsDocumentReadContext\(query, actorUid/)
  })
})
