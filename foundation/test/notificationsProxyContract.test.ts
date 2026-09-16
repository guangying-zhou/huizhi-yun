import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import type { H3Event } from 'h3'
import { requireConsoleNotificationsUserCredentials } from '../server/utils/notifications.ts'

const workspaceRoot = fileURLToPath(new URL('../..', import.meta.url))
const foundationRoot = fileURLToPath(new URL('..', import.meta.url))

function source(path: string) {
  return readFileSync(`${foundationRoot}/${path}`, 'utf8')
}

function event(input: {
  headers?: Record<string, string>
  consoleAuth?: Record<string, unknown>
} = {}) {
  return {
    context: input.consoleAuth ? { consoleAuth: input.consoleAuth } : {},
    node: { req: { headers: input.headers || {} } }
  } as unknown as H3Event
}

function statusCode(error: unknown) {
  return Number((error as { statusCode?: number })?.statusCode || 0)
}

test('business modules do not shadow the Foundation notifications API or slideover', () => {
  const businessModules = ['aims', 'altoc', 'assets', 'workflow', 'codocs', 'finance', 'people', 'webdev', 'align', 'insights']
  for (const moduleName of businessModules) {
    assert.equal(
      existsSync(`${workspaceRoot}/${moduleName}/server/api/notifications.ts`),
      false,
      `${moduleName} must not maintain a shadow notifications API`
    )
  }

  for (const moduleName of businessModules) {
    assert.equal(
      existsSync(`${workspaceRoot}/${moduleName}/app/components/NotificationsSlideover.vue`),
      false,
      `${moduleName} must not maintain a duplicate NotificationsSlideover`
    )
  }

  assert.equal(
    existsSync(`${workspaceRoot}/aims/app/pages/notifications.vue`),
    false,
    'Aims must not expose a static empty notifications page alongside the shared slideover'
  )

  for (const moduleName of businessModules) {
    const layoutPath = `${workspaceRoot}/${moduleName}/app/layouts/default.vue`
    if (!existsSync(layoutPath)) continue
    assert.doesNotMatch(
      readFileSync(layoutPath, 'utf8'),
      /<NotificationsSlideover\b/,
      `${moduleName} must rely on the single slideover mounted by Foundation LayoutSidebar`
    )
  }
})

test('Foundation exposes the complete user notifications proxy surface', () => {
  const routes = [
    {
      file: 'server/api/notifications/index.get.ts',
      consolePath: '/api/v1/console/notifications',
      method: 'GET',
      forwardsQuery: true,
      requiresCredentialsExplicitly: false
    },
    {
      file: 'server/api/notifications/summary.get.ts',
      consolePath: '/api/v1/console/notifications/summary',
      method: 'GET',
      forwardsQuery: false,
      requiresCredentialsExplicitly: false
    },
    {
      file: 'server/api/notifications/[notificationId]/detail.get.ts',
      consolePath: '/api/v1/console/notifications/${encodeURIComponent(notificationId)}/detail',
      method: 'GET',
      forwardsQuery: false,
      requiresCredentialsExplicitly: true
    },
    {
      file: 'server/api/notifications/read-all.post.ts',
      consolePath: '/api/v1/console/notifications/read-all',
      method: 'POST',
      forwardsQuery: false,
      requiresCredentialsExplicitly: true
    },
    {
      file: 'server/api/notifications/[notificationId]/read.post.ts',
      consolePath: '/api/v1/console/notifications/${notificationId}/read',
      method: 'POST',
      forwardsQuery: false,
      requiresCredentialsExplicitly: true
    },
    {
      file: 'server/api/notifications/[notificationId]/archive.post.ts',
      consolePath: '/api/v1/console/notifications/${notificationId}/archive',
      method: 'POST',
      forwardsQuery: false,
      requiresCredentialsExplicitly: true
    }
  ] as const

  for (const route of routes) {
    assert.equal(existsSync(`${foundationRoot}/${route.file}`), true, `${route.file} is required`)
    const content = source(route.file)
    assert.match(content, /fetchConsoleNotificationsForUser\(event,/)
    assert.ok(content.includes(route.consolePath), `${route.file} must forward to ${route.consolePath}`)
    if (route.method === 'POST') assert.match(content, /method:\s*'POST'/)
    if (route.forwardsQuery) assert.match(content, /query:\s*getQuery\(event\)/)
    if (route.requiresCredentialsExplicitly) {
      const guardIndex = content.indexOf('requireConsoleNotificationsUserCredentials(event)')
      const fetchIndex = content.indexOf('fetchConsoleNotificationsForUser(event,')
      assert.ok(guardIndex >= 0 && guardIndex < fetchIndex, `${route.file} must fail closed before proxying`)
    }
  }
})

test('Console auth accepts verified application access tokens for notification detail', () => {
  const middleware = source('server/middleware/console-auth.ts')
  const accessTokenRoutes = middleware.slice(
    middleware.indexOf('function acceptsConsoleApplicationAccessToken'),
    middleware.indexOf('// 仅 Console 自身这些端点')
  )

  assert.match(accessTokenRoutes, /pathname\.endsWith\('\/detail'\)/)
})

test('integration-operation notification links can select the requested failure record', () => {
  const content = source('app/components/IntegrationOperationAdminPage.vue')
  assert.match(content, /route\.query\.status/)
  assert.match(content, /route\.query\.operationId/)
  assert.match(content, /items\.value\.find\(item => item\.operationId === requestedOperationId\)/)
  assert.match(content, /if \(requested\) await openDetail\(requested\)/)
})

test('shared notification center opens authorized details in a modal before business navigation', () => {
  const content = source('app/components/NotificationsSlideover.vue')
  const composable = source('app/composables/useNotifications.ts')
  assert.match(content, /const \{ apps, loadApps \} = useUserApplications\(\)/)
  assert.match(content, /const detail = await loadDetail\(item\.notificationId\)/)
  assert.match(content, /await markRead\(item\.notificationId\)/)
  assert.match(content, /<UModal\b/)
  assert.match(content, /resolveNotificationActionUrl\(selectedDetail\.value, apps\.value, window\.location\.origin\)/)
  assert.match(content, /前往处理/)
  assert.doesNotMatch(content, /resolveNotificationDetailPageUrl\(/)
  assert.doesNotMatch(content, /navigateTo\(detailPageUrl/)
  assert.doesNotMatch(content, /item\.metadata|item\.actionUrl/)
  assert.match(composable, /currentAppCode === 'console'/)
  assert.match(composable, /\/api\/v1\/console\/notifications/)
})

test('notifications proxy accepts only verified user credentials', () => {
  for (const rejected of [
    event(),
    event({ headers: { authorization: 'Bearer unverified-user-or-service-token' } }),
    event({ headers: { cookie: 'hzy_access_token=unverified' } }),
    event({
      headers: { cookie: 'hzy_access_token=user-cookie' },
      consoleAuth: { authenticated: false, tokenUse: 'access', subjectType: 'user' }
    }),
    event({
      headers: { cookie: 'hzy_access_token=user-cookie' },
      consoleAuth: { authenticated: true, tokenUse: 'service', subjectType: 'service', token: 'service-token' }
    }),
    event({
      headers: { cookie: 'hzy_access_token=user-cookie' },
      consoleAuth: { authenticated: true, tokenUse: 'service', token: 'service-token' }
    }),
    event({
      headers: { cookie: 'hzy_access_token=user-cookie' },
      consoleAuth: { authenticated: true, tokenUse: 'access', token: 'access-token' }
    })
  ]) {
    assert.throws(
      () => requireConsoleNotificationsUserCredentials(rejected),
      error => statusCode(error) === 401
    )
  }

  assert.doesNotThrow(() => requireConsoleNotificationsUserCredentials(event({
    consoleAuth: { authenticated: true, tokenUse: 'access', subjectType: 'user', token: 'verified-user-token' }
  })))
  assert.doesNotThrow(() => requireConsoleNotificationsUserCredentials(event({
    headers: { cookie: 'hzy_access_token=verified-session-cookie' },
    consoleAuth: { authenticated: true, tokenUse: 'legacy_session', subjectType: 'user' }
  })))
})


test('user notification reads use the shared Console binding with filters and verified credentials', () => {
  const content = source('server/utils/notifications.ts')
  const proxy = content.slice(content.indexOf('export async function fetchConsoleNotificationsForUser'), content.indexOf('export async function publishNotification'))
  assert.match(proxy, /consoleServiceFetch<ConsoleApiResponse<T>>\(event,/)
  assert.match(proxy, /params: options.query/)
  assert.match(proxy, /headers: forward.headers/)
  assert.ok(proxy.indexOf('if (!forward.headers)') < proxy.indexOf('consoleServiceFetch<'))
  assert.doesNotMatch(proxy, /fetchExternal|await fetch\(/)
})
