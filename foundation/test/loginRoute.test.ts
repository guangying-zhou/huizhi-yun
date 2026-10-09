import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import type { RouteLocationNormalized } from 'vue-router'
import { isLoggedOutLoginRoute, isLoginRoutePath, loginRedirectTarget, loginRoutePaths } from '../app/utils/loginRoute.ts'

const oidcSource = readFileSync(new URL('../app/composables/useConsoleOidcAuth.ts', import.meta.url), 'utf8')
const legacySource = readFileSync(new URL('../app/composables/useLegacyAuthBridge.ts', import.meta.url), 'utf8')

function route(path: string, query: Record<string, string> = {}) {
  return { path, query } as unknown as RouteLocationNormalized
}

describe('login route recognition', () => {
  test('defaults to the plain login path', () => {
    assert.deepEqual(loginRoutePaths(undefined), ['/login'])
    assert.deepEqual(loginRoutePaths({}), ['/login'])
  })

  test('falls back to the configured single login path', () => {
    assert.deepEqual(loginRoutePaths({ enterpriseLoginPath: '/enterprise/login' }), ['/login', '/enterprise/login'])
    assert.deepEqual(loginRoutePaths({ enterpriseLoginPath: '/login' }), ['/login'])
  })

  test('loginPaths overrides the fallback and ignores unusable entries', () => {
    const pub = {
      enterpriseLoginPath: '/ignored',
      loginPaths: ['/enterprise/login', '/login', '/enterprise/login', 'relative', '//host/login', 7, null]
    }
    assert.deepEqual(loginRoutePaths(pub), ['/enterprise/login', '/login'])
  })

  test('every declared login path is recognized', () => {
    const pub = { loginPaths: ['/login', '/aims/login', '/assets/login', '/enterprise/login'] }
    for (const path of pub.loginPaths) assert.equal(isLoginRoutePath(pub, path), true, path)
    assert.equal(isLoginRoutePath(pub, '/enterprise'), false)
    assert.equal(isLoginRoutePath(pub, '/enterpriselogin'), false)
    assert.equal(isLoginRoutePath(pub, '/enterprise/login/extra'), false)
  })

  test('logged-out detection covers prefixed login paths', () => {
    const pub = { loginPaths: ['/login', '/enterprise/login'] }
    assert.equal(isLoggedOutLoginRoute(pub, route('/enterprise/login', { state: 'logged_out' })), true)
    assert.equal(isLoggedOutLoginRoute(pub, route('/enterprise/login', { logged_out: '1' })), true)
    assert.equal(isLoggedOutLoginRoute(pub, route('/login', { state: 'logged_out' })), true)
    assert.equal(isLoggedOutLoginRoute(pub, route('/enterprise/login')), false)
    assert.equal(isLoggedOutLoginRoute(pub, route('/enterprise', { state: 'logged_out' })), false)
  })

  test('Enterprise Host preserves root-mounted return paths without app-home duplication', () => {
    const resolve = (path: string) => `https://hzy0.isme.dev/enterprise/${path.replace(/^\//, '')}`
    const pub = { appCode: 'enterprise', authApiPrefix: '/enterprise' }
    assert.equal(loginRedirectTarget(pub, { fullPath: '/enterprise' }, resolve), '/enterprise')
    assert.equal(loginRedirectTarget(pub, { fullPath: '/aims/products?status=active' }, resolve), '/aims/products?status=active')
    assert.notEqual(loginRedirectTarget(pub, { fullPath: '/enterprise' }, resolve), 'https://hzy0.isme.dev/enterprise/enterprise')
    assert.equal(loginRedirectTarget({ appCode: 'aims' }, { fullPath: '/projects' }, resolve), 'https://hzy0.isme.dev/enterprise/projects')
  })

  test('auth bridges recognize login routes through the shared helper', () => {
    for (const source of [oidcSource, legacySource]) {
      assert.match(source, /from '\.\.\/utils\/loginRoute'/)
      assert.doesNotMatch(source, /to\.path === '\/login'/)
      assert.doesNotMatch(source, /function isLoggedOutRoute\(/)
    }
    assert.match(oidcSource, /if \(isLoginRoutePath\(pub, to\.path\)\)/)
    assert.match(legacySource, /if \(isLoggedOutLoginRoute\(pub, to\)\)/)
  })
})
