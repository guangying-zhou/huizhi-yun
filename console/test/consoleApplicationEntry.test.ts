import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

describe('Console application entry', () => {
  test('separates the workspace root from the Console administration entry', () => {
    const applications = source('server/utils/userApplications.ts')
    const currentConsoleApp = applications.slice(
      applications.indexOf('function currentConsoleApp'),
      applications.indexOf('function normalizeAppItem')
    )
    const mergeCurrentConsoleApp = applications.slice(
      applications.indexOf('function mergeCurrentConsoleApp'),
      applications.indexOf('function appSortOrder')
    )

    assert.match(currentConsoleApp, /homeUrl: '\/admin'/)
    assert.match(currentConsoleApp, /basePath: '\/'/)
    assert.match(mergeCurrentConsoleApp, /homeUrl: currentApp\.homeUrl/)
    assert.match(mergeCurrentConsoleApp, /basePath: currentApp\.basePath/)
  })

  test('only returns the Console application when console_overview view is effective', () => {
    const applications = source('server/utils/userApplications.ts')

    assert.match(applications, /loadPolicyAuthorizationSnapshot\(uid, 'console', event\)/)
    assert.match(applications, /authorizationMode === 'role_simulation'/)
    assert.match(applications, /authorizationMode === 'user_simulation'/)
    assert.match(applications, /includeBaseline: snapshot\.includeBaseline/)
    assert.match(applications, /hasPermissionInSnapshot\(snapshot, 'console_overview', 'view'\)/)
    assert.match(applications, /app\.appCode === 'console'[\s\S]*\? canAccessConsole/)
    assert.doesNotMatch(applications, /catch \{\s*return \[currentApp\]/)
  })

  test('keeps unavailable enterprise modules visible with their operational reason instead of treating them as purchase gates', () => {
    const entitlement = source('server/utils/enterpriseEntitlement.ts')
    const workspace = source('app/pages/index.vue')

    assert.match(entitlement, /availabilityCode: 'module_not_configured'/)
    assert.match(entitlement, /availabilityCode: 'module_not_deployed'/)
    assert.match(workspace, /const unavailableApps = computed/)
    assert.match(workspace, /app\.availabilityMessage/)
    assert.doesNotMatch(entitlement, /planCode|plan_code|subscription/)
  })

  test('reloads both permissions and application menu when simulation starts or ends', () => {
    const session = source('app/composables/useAuthorizationSimulationSession.ts')
    const applications = source('../foundation/app/composables/useUserApplications.ts')
    const createSession = source('server/api/v1/console/authorization/simulation-sessions/index.post.ts')

    assert.match(createSession, /data: \{\s*active: true,/)
    assert.match(session, /const \{ clearApps, loadApps \} = useUserApplications\(\)/)
    assert.match(session, /clearApps\(\)/)
    assert.match(session, /loadApps\(true\)/)
    assert.match(applications, /function clearApplicationsCache\(\)/)
    assert.match(applications, /cacheGeneration \+= 1/)
    assert.match(applications, /loadGeneration !== cacheGeneration/)
    assert.match(applications, /reloadAfterCurrentLoad = true/)
    assert.match(applications, /apps\.value = \[\]/)
  })

  test('restores the real operator simulation controls after a low-permission simulation ends', () => {
    const session = source('app/composables/useAuthorizationSimulationSession.ts')
    const bar = source('app/components/AuthorizationSimulationBar.vue')

    assert.match(session, /operatorControls\?: boolean/)
    assert.match(session, /capabilityLoaded\.value = false/)
    assert.match(session, /enterpriseRolesLoaded\.value = false/)
    assert.match(session, /loadPlatformSimulationCapabilities\(\{ force: true \}\)/)
    assert.match(session, /loadEnterpriseRoles\(\{ force: true \}\)/)
    assert.match(
      session,
      /await refreshAuthorizationState\(\{ operatorControls: true \}\)/
    )
    assert.match(
      bar,
      /refreshAuthorizationState\(\{ operatorControls: true \}\)/
    )
  })
})
