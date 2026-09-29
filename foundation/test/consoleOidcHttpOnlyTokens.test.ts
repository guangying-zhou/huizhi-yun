import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import { afterEach, test } from 'node:test'
import { createEvent } from 'h3'
import { clearConsoleOidcCookies, setConsoleOidcTokenCookies } from '../server/utils/consoleOidc'

const globals = globalThis as { useRuntimeConfig?: () => unknown }
const originalConfig = globals.useRuntimeConfig
afterEach(() => {
  globals.useRuntimeConfig = originalConfig
})

function jwt(claims: Record<string, unknown>) {
  return [Buffer.from('{"alg":"none"}').toString('base64url'), Buffer.from(JSON.stringify(claims)).toString('base64url'), 'sig'].join('.')
}

function eventFor() {
  const req = new IncomingMessage(new Socket())
  req.headers = { 'host': 'localhost', 'x-forwarded-proto': 'https' }
  req.url = '/enterprise/api/auth/refresh'
  req.method = 'POST'
  const res = new ServerResponse(req)
  return { event: createEvent(req, res), res }
}

function cookiesFor(appCode: string, oidcHttpOnlyTokens?: boolean) {
  globals.useRuntimeConfig = () => ({ public: { appCode, ...(oidcHttpOnlyTokens === undefined ? {} : { oidcHttpOnlyTokens }) }, hzy: {} })
  const { event, res } = eventFor()
  const exp = Math.floor(Date.now() / 1000) + 900
  const claims = { sub: 'user:person-a', exp, tenant: 'tenant-a', policy_ver: 'p1', hzy: { uid: 'person-a', subjectCode: 'person-a' } }
  setConsoleOidcTokenCookies(event, { access_token: jwt(claims), id_token: jwt({ ...claims, token_use: 'id' }), refresh_token: 'opaque-refresh', expires_in: 900 } as never)
  const header = res.getHeader('set-cookie')
  const list = ([] as string[]).concat((header as string[] | string | undefined) || [])
  const byName = new Map(list.map(cookie => [cookie.slice(0, cookie.indexOf('=')), cookie]))
  return { byName, exp, event, res }
}

test('Enterprise Host keeps access and ID tokens HttpOnly and exposes only the session expiry', () => {
  const { byName, exp } = cookiesFor('enterprise', true)
  for (const name of ['hzy_enterprise_access_token', 'hzy_enterprise_id_token', 'hzy_enterprise_refresh_token']) {
    assert.match(byName.get(name) || '', /;\s*HttpOnly/i, name)
    assert.match(byName.get(name) || '', /;\s*SameSite=Lax/i, name)
  }
  const expiry = byName.get('hzy_enterprise_session_exp') || ''
  assert.equal(expiry.split(';')[0], `hzy_enterprise_session_exp=${exp}`)
  assert.doesNotMatch(expiry, /HttpOnly/i)
  // Identity hints the browser uses for cache scoping stay readable and non-secret.
  for (const name of ['hzy_enterprise_uid', 'hzy_enterprise_tenant', 'hzy_enterprise_subject_code', 'hzy_enterprise_policy_ver']) {
    assert.ok(byName.has(name), name)
    assert.doesNotMatch(byName.get(name) || '', /HttpOnly/i, name)
  }
})

test('apps without the flag keep their existing browser-readable token cookies', () => {
  for (const flag of [undefined, false]) {
    const { byName } = cookiesFor('aims', flag)
    assert.doesNotMatch(byName.get('hzy_aims_access_token') || '', /HttpOnly/i)
    assert.doesNotMatch(byName.get('hzy_aims_id_token') || '', /HttpOnly/i)
    assert.match(byName.get('hzy_aims_refresh_token') || '', /HttpOnly/i)
    assert.equal(byName.has('hzy_aims_session_exp'), false)
  }
})

test('logout clears the session expiry together with the tokens', () => {
  globals.useRuntimeConfig = () => ({ public: { appCode: 'enterprise', oidcHttpOnlyTokens: true }, hzy: {} })
  const { event, res } = eventFor()
  clearConsoleOidcCookies(event)
  const cleared = ([] as string[]).concat((res.getHeader('set-cookie') as string[]) || [])
  for (const name of ['hzy_enterprise_access_token', 'hzy_enterprise_id_token', 'hzy_enterprise_session_exp']) {
    assert.ok(cleared.some(cookie => cookie.startsWith(`${name}=;`) && /Max-Age=0/i.test(cookie)), name)
  }
})

test('HttpOnly browser mode derives liveness from non-secret cookies and never reads token cookies', () => {
  const source = readFileSync(new URL('../app/composables/useConsoleOidcAuth.ts', import.meta.url), 'utf8')
  const hostConfig = readFileSync(new URL('../../enterprise/nuxt.config.ts', import.meta.url), 'utf8')
  assert.match(hostConfig, /oidcHttpOnlyTokens: true/)
  assert.match(source, /const httpOnlyTokens = publicFlag\(pub\.oidcHttpOnlyTokens\)/)
  assert.match(source, /const claims = computed\(\(\) => httpOnlyTokens \? sessionClaims\.value : decodeJwtClaims\(tokenCookie\.value\)\)/)
  const sync = source.slice(source.indexOf('function syncOidcCookiesFromBrowser'), source.indexOf('function currentTokenKey'))
  assert.match(sync, /if \(httpOnlyTokens\) \{\s*sessionExpiryCookie\.value = readBrowserCookie\(cookieNames\.sessionExpiry\)\s*\} else \{\s*tokenCookie\.value = readBrowserCookie\(cookieNames\.accessToken\)/)
  // 401 -> refresh -> retry keeps the server refresh endpoint as the only renewal path.
  assert.match(source, /await \$fetch\(resolveAuthUrl\('\/api\/auth\/refresh'\), \{ method: 'POST' \}\)/)
})
