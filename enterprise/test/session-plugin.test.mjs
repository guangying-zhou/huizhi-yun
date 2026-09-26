import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { effectScope, onScopeDispose, ref, watch } from 'vue'

const pluginFile = new URL('../app/plugins/enterprise-session.client.ts', import.meta.url)
const bundle = (await build({
  entryPoints: [pluginFile.pathname], bundle: true, format: 'cjs', platform: 'node', write: false,
  external: ['vue']
})).outputFiles[0].text
const pluginModule = { exports: {} }
globalThis.defineNuxtPlugin = callback => callback
new Function('require', 'module', 'exports', bundle)(createRequire(import.meta.url), pluginModule, pluginModule.exports)

const middlewareBundle = (await build({
  entryPoints: [new URL('../app/middleware/session.global.ts', import.meta.url).pathname], bundle: true,
  format: 'cjs', platform: 'node', write: false, define: { 'import.meta.server': 'false' }
})).outputFiles[0].text
const middlewareModule = { exports: {} }
globalThis.defineNuxtRouteMiddleware = callback => callback
new Function('require', 'module', 'exports', middlewareBundle)(createRequire(import.meta.url), middlewareModule, middlewareModule.exports)

function harness() {
  const auth = {
    token: ref('token-a'), user: ref('user-a'), tenant: ref('tenant-a'),
    subjectCode: ref('subject-a'), policyVersion: ref('policy-a'),
    refreshes: 0,
    async refresh() {
      auth.refreshes++
    }
  }
  const pending = []
  const cleared = []
  const listeners = new Map()
  const states = new Map()
  const scope = effectScope()
  globalThis.defineNuxtPlugin = callback => callback
  globalThis.useState = (key, initial) => {
    if (!states.has(key)) states.set(key, ref(typeof initial === 'function' ? initial() : initial))
    return states.get(key)
  }
  globalThis.useAuth = () => auth
  globalThis.useRuntimeConfig = () => ({ public: { authApiPrefix: '', enterpriseLoginPath: '/enterprise/login' } })
  const route = { path: '/aims/projects', fullPath: '/aims/projects?tab=all' }
  const redirects = []
  globalThis.useRouter = () => ({ currentRoute: { value: route } })
  globalThis.navigateTo = (target) => {
    redirects.push(target)
    return target
  }
  globalThis.$fetch = (url, options) => new Promise((resolve, reject) => pending.push({ url, options, resolve, reject }))
  globalThis.clearNuxtData = key => cleared.push(['data', key])
  globalThis.clearNuxtState = key => cleared.push(['state', key])
  globalThis.watch = watch
  globalThis.onScopeDispose = onScopeDispose
  globalThis.window = { addEventListener: (event, handler) => listeners.set(event, handler), removeEventListener() {} }
  const plugin = scope.run(() => pluginModule.exports.default({ runWithContext: fn => fn() }))
  return { auth, pending, cleared, listeners, route, redirects, scope: states.get('enterprise-cache-scope'), verified: states.get('enterprise-verified-scope'), session: plugin.provide.enterpriseSession, dispose: () => scope.stop() }
}

const session = (tenant = 'tenant-a', uid = 'user-a') => ({
  authenticated: true, provider: 'console_oidc', tenant, uid, subjectCode: `subject-${uid}`, policyVersion: 'policy-a'
})
const settle = () => new Promise(resolve => setImmediate(resolve))

test('user and subject changes synchronously invalidate the verified enterprise scope', async t => {
  const h = harness()
  t.after(h.dispose)
  const initial = h.session.refresh()
  await Promise.resolve()
  h.pending[0].resolve(session())
  assert.equal(await initial, JSON.stringify(['tenant-a', 'user-a', 'subject-user-a', 'policy-a', '']))
  assert.notEqual(h.scope.value, '')

  h.auth.user.value = 'user-b'
  assert.equal(h.scope.value, '', 'identity changes clear before the next tick')
  assert.equal(h.verified.value, JSON.stringify(['tenant-a', 'user-a', 'subject-user-a', 'policy-a', '']), 'page identity lags the invalidation window')
  await Promise.resolve()
  assert.equal(h.pending.length, 2)
  h.pending[1].resolve(session('tenant-a', 'user-b'))
  await settle()
  assert.equal(h.scope.value, JSON.stringify(['tenant-a', 'user-b', 'subject-user-b', 'policy-a', '']))
  assert.equal(h.verified.value, JSON.stringify(['tenant-a', 'user-b', 'subject-user-b', 'policy-a', '']))

  h.auth.subjectCode.value = 'subject-c'
  assert.equal(h.scope.value, '')
  await Promise.resolve()
  assert.equal(h.pending.length, 3)
  h.pending[2].resolve({ ...session('tenant-a', 'user-b'), subjectCode: 'subject-c' })
  await settle()
  assert.equal(h.scope.value, JSON.stringify(['tenant-a', 'user-b', 'subject-c', 'policy-a', '']))
})

test('a superseded me response cannot restore identity, while same-scope focus keeps the lease pending', async t => {
  const h = harness()
  t.after(h.dispose)
  const initial = h.session.refresh()
  await Promise.resolve()
  h.pending[0].resolve(session())
  await initial

  h.listeners.get('focus')()
  assert.equal(h.scope.value, JSON.stringify(['tenant-a', 'user-a', 'subject-user-a', 'policy-a', '']))
  await Promise.resolve()
  assert.equal(h.pending.length, 2)
  h.auth.user.value = 'user-b'
  assert.equal(h.scope.value, '')
  await Promise.resolve()
  h.pending[1].resolve(session())
  await settle()
  assert.equal(h.scope.value, '', 'the old user response is ignored after invalidation')
  assert.equal(h.verified.value, JSON.stringify(['tenant-a', 'user-a', 'subject-user-a', 'policy-a', '']), 'a superseded response must not move page identity')
  assert.equal(h.pending.length, 3)
  h.pending[2].resolve(session('tenant-a', 'user-b'))
  await settle()
  assert.equal(h.scope.value, JSON.stringify(['tenant-a', 'user-b', 'subject-user-b', 'policy-a', '']))
  assert.equal(h.verified.value, JSON.stringify(['tenant-a', 'user-b', 'subject-user-b', 'policy-a', '']))
  assert.equal(h.cleared.length >= 2, true)
})

test('session middleware starts the first verified request through the plugin bridge', async t => {
  const h = harness()
  t.after(h.dispose)
  const navigations = []
  globalThis.useNuxtApp = () => ({ $enterpriseSession: h.session })
  globalThis.useRuntimeConfig = () => ({ public: { enterpriseLoginPath: '/login' } })
  globalThis.navigateTo = target => { navigations.push(target); return target }
  globalThis.createError = value => value
  const routeCheck = middlewareModule.exports.default({ path: '/aims/projects', fullPath: '/aims/projects?search=Alpha' })
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(h.pending.length, 1)
  h.pending[0].resolve(session())
  assert.equal(await routeCheck, undefined)
  assert.equal(h.scope.value, JSON.stringify(['tenant-a', 'user-a', 'subject-user-a', 'policy-a', '']))
  assert.deepEqual(navigations, [])
})

test('a confirmed sign-out on an open page leaves for login once; an unavailable check does not', async (t) => {
  const h = harness()
  t.after(h.dispose)
  const first = h.session.refresh()
  await settle()
  h.pending.shift().resolve(session())
  await first
  const failing = h.session.refresh()
  await settle()
  h.pending.shift().reject(Object.assign(Error('unavailable'), { statusCode: 503 }))
  await assert.rejects(failing)
  assert.deepEqual(h.redirects, [], 'an unavailable session check is not a sign-out')
  const recovered = h.session.refresh()
  await settle()
  h.pending.shift().resolve(session())
  await recovered
  const lost = h.session.refresh()
  await settle()
  h.pending.shift().resolve({ authenticated: false, provider: 'console_oidc' })
  assert.equal(await lost, '')
  await settle()
  assert.deepEqual(h.redirects, [{ path: '/enterprise/login', query: { redirect: '/aims/projects?tab=all' } }])
  const signedIn = h.session.refresh()
  await settle()
  h.pending.shift().resolve(session())
  await signedIn
  h.route.path = '/enterprise/login'
  const onLogin = h.session.refresh()
  await settle()
  h.pending.shift().resolve({ authenticated: false, provider: 'console_oidc' })
  await onLogin
  assert.equal(h.redirects.length, 1, 'the login page is never redirected to itself')
})

test('an expired access token is renewed and re-checked instead of leaving for login', async (t) => {
  const h = harness()
  t.after(h.dispose)
  const first = h.session.refresh()
  await settle()
  h.pending.shift().resolve(session())
  await first
  const renewed = h.session.refresh()
  await settle()
  h.pending.shift().resolve({ authenticated: false, refreshable: true, provider: 'console_oidc' })
  await settle()
  assert.equal(h.auth.refreshes, 1)
  assert.equal(h.pending.length, 1, 'the session is checked again after renewal')
  h.pending.shift().resolve(session())
  assert.equal(await renewed, JSON.stringify(['tenant-a', 'user-a', 'subject-user-a', 'policy-a', '']))
  assert.deepEqual(h.redirects, [])
})
