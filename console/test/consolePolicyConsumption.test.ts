import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

function rootSource(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
}

function assertBefore(content: string, left: string, right: string) {
  const leftIndex = content.indexOf(left)
  const rightIndex = content.indexOf(right)

  assert.notEqual(leftIndex, -1, `Missing ${left}`)
  assert.notEqual(rightIndex, -1, `Missing ${right}`)
  assert.ok(leftIndex < rightIndex, `${left} must appear before ${right}`)
}

describe('Console policy permission consumption', () => {
  test('menu filtering and client route guard consume the shared permission snapshot', () => {
    const permissionsConfig = source('app/config/permissions.ts')
    const layout = source('app/layouts/default.vue')
    const permissionMiddleware = source('app/middleware/permission.global.ts')
    const foundationPermission = rootSource('foundation/app/composables/usePlatformPermission.ts')

    assert.match(permissionsConfig, /export const menus/)
    assert.match(permissionsConfig, /export const routeRules/)
    assert.match(permissionsConfig, /to: '\/org-profile'[\s\S]*resource: 'org_profile'/)
    assert.match(permissionsConfig, /pattern: '\/org-profile'[\s\S]*resource: 'org_profile'[\s\S]*action: 'view'/)

    assert.match(layout, /import \{ menus as rawMenus \} from '~\/config\/permissions'/)
    assert.match(layout, /const \{ loadPermissions, filterMenus, loaded: permissionsLoaded, hasPermission \} = usePermissions\(\)/)
    assert.match(layout, /filterMenus\(rawMenus\) as NavigationMenuItem\[\]\[\]/)
    assert.match(layout, /\.map\(group => expandCurrentRouteGroups\(group\)\)/)

    assert.match(foundationPermission, /const \{ loadAuthorization, getAuthorization, clearAuthorizationCache, loaded \} = useAuthorization\(\)/)
    assert.match(foundationPermission, /function filterMenus\(menuGroups: PermissionMenuItem\[\]\[\]\)/)
    assert.match(foundationPermission, /hasPermission: \(resourceCode, action\) => hasPermission\(resourceCode, \(action as PermissionAction\) \|\| 'view'\)/)
    assert.match(foundationPermission, /resourceCode: item\.resourceCode \|\| item\.resource/)

    assert.match(permissionMiddleware, /import \{ matchRouteRule \} from '~\/config\/permissions'/)
    assert.match(permissionMiddleware, /const rule = matchRouteRule\(to\.path\)/)
    assert.match(permissionMiddleware, /const \{ loaded, loadPermissions, hasPermission, clearCache \} = usePermissions\(\)/)
    assertBefore(
      permissionMiddleware,
      'await loadPermissions()',
      'if (!hasPermission(rule.resource, action))'
    )
    assert.match(permissionMiddleware, /return navigateTo\('\/settings\/profile', \{ replace: true \}\)/)
  })

  test('server page guard and API guard use the local policy bundle authorization snapshot', () => {
    const pageAccess = source('server/middleware/page-access.ts')
    const permissionsEndpoint = source('server/api/auth/permissions.get.ts')
    const checkPermission = source('server/utils/checkPermission.ts')
    const businessDomains = source('server/api/v1/console/business-domains/index.get.ts')

    assert.match(pageAccess, /import \{ appCode, matchRouteRule \} from '~~\/app\/config\/permissions'/)
    assert.match(pageAccess, /const rule = matchRouteRule\(pathname\)/)
    assert.match(pageAccess, /const snapshot = await loadPolicyAuthorizationSnapshot\(session\.uid, appCode, event\)/)
    assert.match(pageAccess, /if \(!hasPermissionInSnapshot\(snapshot, rule\.resource, rule\.action\)\)/)

    assert.match(permissionsEndpoint, /const snapshot = await loadPolicyAuthorizationSnapshot\(uid, targetAppCode, event\)/)
    assert.match(permissionsEndpoint, /resources: snapshot\.resources/)
    assert.doesNotMatch(permissionsEndpoint, /\/api\/v1\/users|accountLookup|Account\s+API/)

    assert.match(checkPermission, /const snapshot = await loadPolicyAuthorizationSnapshot\(uid, appCode, event\)/)
    assert.match(checkPermission, /return hasPermissionInSnapshot\(snapshot, resource, action\)/)
    assert.match(checkPermission, /export async function requirePermission/)
    assert.doesNotMatch(checkPermission, /\/api\/v1\/users|accountLookup|Account\s+API/)

    assertBefore(
      businessDomains,
      'await requirePermission(event, \'org_profile\', \'view\')',
      'getConsoleBusinessDomains(event, getQuery(event))'
    )
  })

  test('org profile view grant is consumed by route, menu and server API guards through one snapshot builder', () => {
    const policyAuthorization = source('server/utils/policyAuthorization.ts')
    const permissionsConfig = source('app/config/permissions.ts')
    const businessDomains = source('server/api/v1/console/business-domains/index.get.ts')
    const pageAccess = source('server/middleware/page-access.ts')
    const permissionsEndpoint = source('server/api/auth/permissions.get.ts')
    const checkPermission = source('server/utils/checkPermission.ts')

    assert.match(policyAuthorization, /export function buildPolicyAuthorizationSnapshotFromPayload/)
    assert.match(policyAuthorization, /for \(const permission of rolePermissionGrantRecords\(payload\)\)/)
    assert.match(policyAuthorization, /const grants = buildFlatSnapshotGrants\(collectedPermissions, targetAppCode\)/)
    assert.match(policyAuthorization, /normalizeAuthorizationResources\(\s*grants\.map\(grant => grant\.permission\),\s*targetAppCode\s*\)/)
    assert.match(policyAuthorization, /const snapshot = buildPolicyAuthorizationSnapshotFromPayload\(\{/)

    assert.match(permissionsConfig, /to: '\/org-profile'[\s\S]*resource: 'org_profile'/)
    assert.match(permissionsConfig, /pattern: '\/org-profile'[\s\S]*resource: 'org_profile'[\s\S]*action: 'view'/)
    assert.match(permissionsConfig, /pattern: '\/admin\/business-domains'[\s\S]*resource: 'org_profile'[\s\S]*action: 'view'/)
    assert.match(businessDomains, /requirePermission\(event, 'org_profile', 'view'\)/)

    assert.match(pageAccess, /const snapshot = await loadPolicyAuthorizationSnapshot\(session\.uid, appCode, event\)/)
    assert.match(permissionsEndpoint, /const snapshot = await loadPolicyAuthorizationSnapshot\(uid, targetAppCode, event\)/)
    assert.match(checkPermission, /const snapshot = await loadPolicyAuthorizationSnapshot\(uid, appCode, event\)/)
  })

  test('acceptance script covers authorized and unauthorized protected access', () => {
    const script = rootSource('scripts/accept-console-policy-consumption.mjs')

    assert.match(script, /E8-T24 \/ E8-T16/)
    assert.match(script, /const permissionsUrl = `\$\{args\.baseUrl\}\/api\/auth\/permissions`/)
    assert.match(script, /protectedPath: '\/api\/v1\/console\/business-domains'/)
    assert.match(script, /anonymous\.status === 401/)
    assert.match(script, /authorized \/api\/auth\/permissions failed/)
    assert.match(script, /resource \$\{args\.resource\}:\$\{args\.action\} granted/)
    assert.match(script, /protectedOk\.status >= 200 && protectedOk\.status < 300/)
    assert.match(script, /protectedAnonymous\.status === 401 \|\| protectedAnonymous\.status === 403/)
    assert.match(script, /deniedProtected\.status === 401 \|\| deniedProtected\.status === 403/)
  })
})
