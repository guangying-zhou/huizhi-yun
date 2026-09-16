import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import assert from 'node:assert/strict'
import { getDirectoryAuthHeaders } from '../server/utils/directoryApi.ts'

function event(headers: Record<string, string>) {
  return {
    node: {
      req: {
        headers
      }
    }
  } as never
}

test('Console Directory adapter never retries an authorization denial through a legacy route', () => {
  const path = fileURLToPath(new URL('../server/utils/directoryApi.ts', import.meta.url))
  const content = readFileSync(path, 'utf8')
  const handler = content.slice(content.indexOf('export async function fetchConsoleDirectoryApi'))
  const externalRequest = handler.slice(handler.indexOf('// Directory reads contain employee PII.'))

  assert.match(externalRequest, /return fetchDirectoryApi<T>\(`\/api\/v1\/console\/directory\$\{normalizedPath\}`, options\)/)
  assert.doesNotMatch(externalRequest, /\/api\/v1\/directory\$\{normalizedPath\}/)
  assert.doesNotMatch(externalRequest, /statusCode !== 401/)
})

test('business app department trees use the restricted service projection instead of Console UI permission', () => {
  const path = fileURLToPath(new URL('../server/utils/directoryApi.ts', import.meta.url))
  const content = readFileSync(path, 'utf8')
  const handler = content.slice(content.indexOf('export async function fetchConsoleDirectoryApi'))

  assert.match(content, /requestWithServiceAccessToken/)
  assert.match(content, /trustedServiceRequestHeaders/)
  assert.match(handler, /normalizedPath === '\/departments'/)
  assert.match(content, /console:directory-users:read/)
  assert.match(content, /\/api\/v1\/console\/service\/directory\/users/)
  assert.match(handler, /fetchDirectorySharingByService<T>\(options, 'departments'\)/)
  assert.doesNotMatch(
    handler.slice(handler.indexOf('normalizedPath === \'/departments\''), handler.indexOf('// Directory reads contain employee PII.')),
    /\/api\/v1\/console\/directory/
  )
})

test('business app user lists use the restricted sharing projection instead of Console UI permission', () => {
  const path = fileURLToPath(new URL('../server/utils/directoryApi.ts', import.meta.url))
  const content = readFileSync(path, 'utf8')
  const handler = content.slice(content.indexOf('export async function fetchConsoleDirectoryApi'))
  const branchStart = handler.indexOf('if (normalizedPath === \'/users\'')
  const branchEnd = handler.indexOf('\n  }', branchStart) + 4
  const serviceRead = handler.slice(branchStart, branchEnd)

  assert.match(handler, /normalizedPath === '\/users'/)
  assert.match(content, /console:directory-users:read/)
  assert.match(content, /\/api\/v1\/console\/service\/directory\/users/)
  assert.match(serviceRead, /fetchDirectorySharingByService<T>\(options\)/)
  assert.doesNotMatch(serviceRead, /\/api\/v1\/console\/directory/)
})

test('business app user detail uses the restricted sharing projection instead of Console UI permission', () => {
  const path = fileURLToPath(new URL('../server/utils/directoryApi.ts', import.meta.url))
  const content = readFileSync(path, 'utf8')
  const handler = content.slice(content.indexOf('export async function fetchConsoleDirectoryApi'))

  assert.match(content, /fetchDirectorySharingUserByService/)
  assert.match(handler, /const userDetailMatch = normalizedPath\.match/)
  assert.match(handler, /\^\\\/users\\\/\(\[\^\/\]\+\)\$/)
  assert.match(handler, /fetchDirectorySharingUserByService<T>/)
  assert.match(content, /params: \{ \.\.\.options\.params, uids: uid \}/)
  assert.doesNotMatch(
    handler.slice(handler.indexOf('const userDetailMatch'), handler.indexOf('// Directory reads contain employee PII.')),
    /\/api\/v1\/console\/directory/
  )
})

test('business app business-domain dictionaries use an exact service capability instead of Console UI permission', () => {
  const helperPath = fileURLToPath(new URL('../server/utils/directoryApi.ts', import.meta.url))
  const routePath = fileURLToPath(new URL('../server/api/directory/business-domains.get.ts', import.meta.url))
  const helper = readFileSync(helperPath, 'utf8')
  const route = readFileSync(routePath, 'utf8')

  assert.match(helper, /export async function fetchConsoleBusinessDomainsByService/)
  assert.match(helper, /scope: 'console:business-domain:view'/)
  assert.match(helper, /\/api\/v1\/console\/service\/business-domains/)
  assert.match(route, /fetchConsoleBusinessDomainsByService/)
  assert.match(route, /\{\s*event,\s*params: getQuery\(event\)\s*\}/)
  assert.doesNotMatch(route, /fetchConsoleApi|\/api\/v1\/business-domains/)
})

test('user directory BFF explicitly passes its request context to the Directory adapter', () => {
  const routePath = fileURLToPath(new URL('../server/api/directory/users/[uid].get.ts', import.meta.url))
  const route = readFileSync(routePath, 'utf8')

  assert.match(route, /fetchConsoleDirectoryApi\(`\/users\/\$\{encodeURIComponent\(uid\)\}`, \{ event \}\)/)
})

test('directory list BFF routes preserve the current user session for Console authorization', () => {
  const routePaths = [
    '../server/api/directory/users/index.get.ts',
    '../server/api/directory/users/batch.post.ts',
    '../server/api/directory/users/[uid]/projects.get.ts',
    '../server/api/directory/projects/index.get.ts',
    '../server/api/directory/projects/[projectCode].get.ts',
    '../server/api/directory/departments/index.get.ts',
    '../server/api/directory/departments/[deptCode].get.ts',
    '../server/api/directory/departments/[deptCode]/members.get.ts',
    '../server/api/directory/user-departments.get.ts',
    '../server/api/directory/meta.get.ts'
  ]

  for (const relativePath of routePaths) {
    const routePath = fileURLToPath(new URL(relativePath, import.meta.url))
    const route = readFileSync(routePath, 'utf8')

    assert.match(route, /fetchConsoleDirectoryApi/)
    assert.match(route, /\{\s*event[,\s}]/)
  }
})

test('shared user menu reads the current session profile instead of requiring arbitrary-user directory permission', () => {
  const menuPath = fileURLToPath(new URL('../app/components/UserMenu.vue', import.meta.url))
  const routePath = fileURLToPath(new URL('../server/api/directory/me.get.ts', import.meta.url))
  const menu = readFileSync(menuPath, 'utf8')
  const route = readFileSync(routePath, 'utf8')

  assert.match(menu, /'\/api\/directory\/me'/)
  assert.doesNotMatch(menu, /\/api\/directory\/users\/\$\{encodeURIComponent\(uid\)\}/)
  assert.match(route, /fetchConsoleApi<ConsoleCurrentUserResponse>\('\/auth\/me', \{ event \}\)/)
  assert.match(route, /!response\.data\?\.authenticated/)
})

test('Console self-requests stay inside Nitro and preserve the current request context', () => {
  const path = fileURLToPath(new URL('../server/utils/directoryApi.ts', import.meta.url))
  const content = readFileSync(path, 'utf8')
  const localFetch = content.slice(content.indexOf('function localFetch'), content.indexOf('export function getDirectoryConfig'))
  const consoleApi = content.slice(content.indexOf('export async function fetchConsoleApi'))

  assert.match(localFetch, /options\.event[\s\S]*\?\.\$fetch/)
  assert.match(consoleApi, /getCurrentAppCode\(\) === 'console'/)
  assert.match(consoleApi, /return localFetch<T>\(`\/api\/v1\/console\$\{normalizedPath\}`, options\)/)
})

test('Console Directory adapter forwards the verified session without leaking the caller deployment into Console authorization', () => {
  const headers = getDirectoryAuthHeaders({
    provider: 'console',
    consoleApiUrl: 'https://console.example.test',
    timeoutMs: 10000
  }, event({
    'cookie': 'console_session=session-1; hzy_codocs_uid=user-1',
    'x-hzy-gateway': 'tenant-gateway',
    'x-hzy-gateway-token': 'gateway-token',
    'x-hzy-tenant': 'C000001',
    'x-hzy-deployment': 'C000001-codocs',
    'x-forwarded-host': 'tenant.example.test',
    'x-untrusted-header': 'must-not-forward'
  }))

  assert.deepEqual(headers, {
    'cookie': 'console_session=session-1; hzy_codocs_uid=user-1',
    'x-hzy-gateway': 'tenant-gateway',
    'x-hzy-gateway-token': 'gateway-token',
    'x-hzy-tenant': 'C000001',
    'x-forwarded-host': 'tenant.example.test'
  })
})
