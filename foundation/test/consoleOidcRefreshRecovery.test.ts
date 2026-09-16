import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runConsoleOidcRefreshSingleFlight } from '../app/composables/useConsoleOidcAuth'
import {
  readUserApplicationsSessionCache,
  USER_APPLICATIONS_SESSION_CACHE_STALE_TTL_MS,
  USER_APPLICATIONS_SESSION_CACHE_TTL_MS,
  writeUserApplicationsSessionCache
} from '../app/utils/userApplicationsSessionCache'

const source = readFileSync(new URL('../app/composables/useConsoleOidcAuth.ts', import.meta.url), 'utf8')
const applicationsSource = readFileSync(new URL('../app/composables/useUserApplications.ts', import.meta.url), 'utf8')
const authMeSource = readFileSync(new URL('../server/api/auth/me.get.ts', import.meta.url), 'utf8')
const consoleOidcSource = readFileSync(new URL('../server/utils/consoleOidc.ts', import.meta.url), 'utf8')

function blockBetween(start: string, end: string) {
  const startIndex = source.indexOf(start)
  assert.notEqual(startIndex, -1, `Missing ${start}`)
  const endIndex = source.indexOf(end, startIndex)
  assert.notEqual(endIndex, -1, `Missing ${end}`)
  return source.slice(startIndex, endIndex)
}

function createSessionStorage() {
  const values = new Map<string, string>()
  return {
    getItem(key: string) {
      return values.get(key) || null
    },
    setItem(key: string, value: string) {
      values.set(key, value)
    },
    removeItem(key: string) {
      values.delete(key)
    }
  }
}

describe('Console OIDC refresh recovery', () => {
  test('route access only attempts refresh when the server has a refresh token', () => {
    const recoverBlock = blockBetween(
      'async function recoverServerSession()',
      'async function handleRouteAccess'
    )
    const routeBlock = blockBetween(
      'async function handleRouteAccess',
      'return {'
    )

    assert.doesNotMatch(recoverBlock, /if\s*\(\s*!token\.value\s*\)/)
    assert.match(recoverBlock, /response\?\.refreshable\s*!==\s*true/)
    assert.match(recoverBlock, /await refresh\(\)/)
    assert.match(routeBlock, /if\s*\(\s*await recoverServerSession\(\)\s*\)/)
    assert.doesNotMatch(routeBlock, /if\s*\(\s*token\.value\s*\)\s*{\s*try\s*{\s*await refresh\(\)/s)
  })

  test('auth status reports refreshability without exposing the refresh token', () => {
    assert.match(consoleOidcSource, /export function hasConsoleOidcRefreshToken/)
    assert.match(authMeSource, /refreshable:\s*hasConsoleOidcRefreshToken\(event\)/)
    assert.doesNotMatch(authMeSource, /refreshToken\s*:/)
  })

  test('concurrent refreshes in one page share a single token rotation', async () => {
    let requestCount = 0
    let releaseRequest!: () => void
    const requestGate = new Promise<void>((resolve) => {
      releaseRequest = resolve
    })

    const options = {
      requestKey: 'hzy_codocs_access_token',
      getTokenKey: () => 'old-token',
      hasActiveToken: () => true,
      syncCookies: () => {},
      performRefresh: async () => {
        requestCount += 1
        await requestGate
      }
    }

    const first = runConsoleOidcRefreshSingleFlight(options)
    const second = runConsoleOidcRefreshSingleFlight(options)
    await Promise.resolve()

    assert.equal(requestCount, 1)
    releaseRequest()
    await Promise.all([first, second])
    assert.equal(requestCount, 1)
  })

  test('a tab waiting for the refresh lock reuses the token rotated by another tab', async () => {
    let tokenKey = 'old-token'
    let requestCount = 0
    let releaseLock!: () => void
    const lockGate = new Promise<void>((resolve) => {
      releaseLock = resolve
    })

    const refresh = runConsoleOidcRefreshSingleFlight({
      requestKey: 'hzy_people_access_token',
      getTokenKey: () => tokenKey,
      hasActiveToken: () => tokenKey === 'new-token',
      syncCookies: () => {},
      performRefresh: async () => {
        requestCount += 1
      },
      withCrossTabLock: async (_name, task) => {
        await lockGate
        await task()
      }
    })

    tokenKey = 'new-token'
    releaseLock()
    await refresh

    assert.equal(requestCount, 0)
  })

  test('refresh failure does not delete cookies that another request may have rotated', () => {
    const refreshHandler = consoleOidcSource.slice(
      consoleOidcSource.indexOf('export async function handleConsoleOidcRefresh'),
      consoleOidcSource.indexOf('export async function handleConsoleOidcLogout')
    )

    assert.doesNotMatch(refreshHandler, /clearConsoleOidcCookies\(event\)/)
  })

  test('expired or revoked sessions request reauthentication without turning an expected refresh miss into a 401', () => {
    const refreshHandler = consoleOidcSource.slice(
      consoleOidcSource.indexOf('export async function handleConsoleOidcRefresh'),
      consoleOidcSource.indexOf('export async function handleConsoleOidcLogout')
    )

    assert.match(refreshHandler, /isConsoleOidcReauthenticationRequired\(error\)/)
    assert.match(refreshHandler, /reauthenticationRequired:\s*true/)
    assert.match(refreshHandler, /reason:\s*'session_expired_or_revoked'/)
    assert.match(refreshHandler, /throw error/)
    assert.doesNotMatch(refreshHandler, /setResponseStatus/)
  })

  test('application menu can hydrate stale data while it revalidates', () => {
    const storage = createSessionStorage()
    const cachedAt = 1_000
    const fingerprint = '1|u1001|tenant|policy'
    const item = { appCode: 'codocs' }
    writeUserApplicationsSessionCache(storage, fingerprint, [item], cachedAt)

    const staleNow = cachedAt + USER_APPLICATIONS_SESSION_CACHE_TTL_MS + 1
    assert.ok(staleNow < cachedAt + USER_APPLICATIONS_SESSION_CACHE_STALE_TTL_MS)
    assert.deepEqual(
      readUserApplicationsSessionCache(
        storage,
        fingerprint,
        value => value as typeof item,
        staleNow,
        { allowStale: true }
      ),
      [item]
    )
  })

  test('authorization retry failure keeps an already-rendered application menu', () => {
    const catchBlock = applicationsSource.slice(
      applicationsSource.indexOf('} catch (error) {', applicationsSource.indexOf('async function loadApplications')),
      applicationsSource.indexOf('} finally {', applicationsSource.indexOf('async function loadApplications'))
    )

    assert.doesNotMatch(catchBlock, /clearSessionCache\(\)/)
    assert.doesNotMatch(catchBlock, /authorizationRejected[\s\S]*apps\.value\s*=\s*\[\]/)
  })
})
