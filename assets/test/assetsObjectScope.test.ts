import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  assetsObjectAccessFromScopedAuthorization,
  assetsObjectScopeFromScopedAuthorization,
  assetsObjectScopeQuery,
  sanitizeAssetsObjectAccessRecord
} from '../server/utils/assetsScopedAuthorizationCore.ts'

function grant(action: string, scopes: Array<{ dimension: string, predicate: string, value?: string }> = []) {
  return {
    permissions: [{ appCode: 'assets', resourceCode: 'asset_items', action }],
    defaultScopes: scopes,
    assignmentScopes: [],
    scopes: []
  }
}

test('normal merged grants resolve action-specific all, relation and none access', () => {
  const relation = grant('view', [{ dimension: 'asset', predicate: 'user' }])
  const unsupported = grant('view', [{ dimension: 'unsupported', predicate: 'tree' }])
  const tenantGlobal = grant('view', [{ dimension: 'tenant', predicate: 'global' }])
  assert.equal(assetsObjectAccessFromScopedAuthorization({ grants: [relation] } as never, 'asset_items', 'view'), 'relation')
  assert.equal(assetsObjectAccessFromScopedAuthorization({ grants: [unsupported] } as never, 'asset_items', 'view'), 'none')
  assert.equal(assetsObjectAccessFromScopedAuthorization({ grants: [relation, grant('view')] } as never, 'asset_items', 'view'), 'all')
  assert.equal(assetsObjectAccessFromScopedAuthorization({ grants: [tenantGlobal] } as never, 'asset_items', 'view'), 'all')
  assert.equal(assetsObjectAccessFromScopedAuthorization({ grants: [grant('admin', unsupported.defaultScopes)] } as never, 'asset_items', 'view'), 'all')
  assert.equal(assetsObjectAccessFromScopedAuthorization({ grants: [relation] } as never, 'asset_items', 'edit'), 'none')
  assert.equal(assetsObjectAccessFromScopedAuthorization({ grants: [grant('edit', relation.defaultScopes)] } as never, 'asset_items', 'view'), 'relation')
  assert.equal(assetsObjectAccessFromScopedAuthorization({ grants: [] } as never, 'asset_items', 'view'), 'none')
})

test('department and project scopes remain bounded grant units instead of becoming direct relation', () => {
  const department = grant('view', [{ dimension: 'department', predicate: 'tree', value: 'D-ROOT' }])
  const project = grant('view', [{ dimension: 'project', predicate: 'code', value: 'P-1' }])
  const scope = assetsObjectScopeFromScopedAuthorization(
    { grants: [department, project] } as never,
    'asset_items', 'view', [], { 'D-ROOT': ['D-ROOT', 'D-CHILD'] }
  )
  assert.deepEqual(scope, {
    access: 'relation',
    units: [
      { directRelation: false, relationPredicates: [], departmentCodes: ['D-ROOT', 'D-CHILD'], projectCodes: [] },
      { directRelation: false, relationPredicates: [], departmentCodes: [], projectCodes: ['P-1'] }
    ]
  })
  assert.match(String(assetsObjectScopeQuery(scope).current_user_assets_scope_units), /D-CHILD/)
})

test('asset relation predicates remain exact instead of widening asset:user to owner or custodian', () => {
  const userScope = assetsObjectScopeFromScopedAuthorization(
    { grants: [grant('view', [{ dimension: 'asset', predicate: 'user' }])] } as never,
    'asset_items', 'view'
  )
  assert.deepEqual(userScope.units[0]?.relationPredicates, ['user'])

  const keeperScope = assetsObjectScopeFromScopedAuthorization(
    { grants: [grant('view', [{ dimension: 'asset', predicate: 'keeper' }])] } as never,
    'asset_items', 'view'
  )
  assert.deepEqual(keeperScope.units[0]?.relationPredicates, ['custodian'])
})

test('project member and owner scopes do not degrade into project-code access without relation facts', () => {
  for (const predicate of ['member', 'owner']) {
    const scope = assetsObjectScopeFromScopedAuthorization(
      { grants: [grant('view', [{ dimension: 'project', predicate, value: 'P-1' }])] } as never,
      'asset_items', 'view'
    )
    assert.deepEqual(scope, { access: 'none', units: [] })
  }
})

test('trusted object access fields are always removed from browser-controlled input', () => {
  assert.deepEqual(sanitizeAssetsObjectAccessRecord({
    keyword: 'AST',
    current_user_assets_object_access: 'all',
    currentUserAssetsObjectAccess: 'all',
    current_user_assets_scope_units: '[]',
    currentUserAssetsScopeUnits: '[]',
    current_user_assets_permission_action: 'admin',
    currentUserAssetsPermissionAction: 'admin'
  }), { keyword: 'AST' })
})

test('Assets proxy derives trusted scope after authentication and does not trust browser all/current user', () => {
  const middleware = readFileSync(new URL('../server/middleware/tenant-runtime.ts', import.meta.url), 'utf8')
  assert.match(middleware, /resolveQuery: resolveAssetsRuntimeQuery/)
  assert.match(middleware, /sanitizeAssetsObjectAccessRecord\(input\)/)
  assert.match(middleware, /delete context\.body\.current_user_assets_object_access/)
  assert.match(middleware, /delete context\.body\.current_user_assets_permission_action/)
  assert.match(middleware, /resolveAssetsObjectScopeQuery\(/)
  assert.match(middleware, /\['dashboard', 'asset_items', 'ip_assets', 'assignments', 'alerts', 'offboarding_recoveries'\]/)
  assert.match(middleware, /current_user_assets_permission_action/)
  const resolver = readFileSync(new URL('../server/utils/assetsScopedAuthorization.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(resolver, /activeRoleCode|authorizationMode/)
  assert.ok(middleware.indexOf('await ensureAssetsConsoleAuth(event)') < middleware.indexOf('resolveQuery: resolveAssetsRuntimeQuery'))
})
