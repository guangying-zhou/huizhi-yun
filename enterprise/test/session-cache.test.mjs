import test from 'node:test'
import assert from 'node:assert/strict'
import { createSessionCacheCoordinator, isEnterpriseSessionCacheKey, validatedSessionScope, safeLoginRedirect, watchSessionLoss } from '../shared/session-cache.mjs'
const session = (tenant, uid, policyVersion = 'p1') => ({ authenticated: true, provider: 'console_oidc', tenant, uid, policyVersion, subjectCode: `user:${uid}` })

test('tenant, actor, and policy changes yield distinct verified cache identities', async () => {
  const values = [session('A', '1'), session('B', '1'), session('B', '2'), session('B', '2', 'p2'), { authenticated: false }]
  const transitions = []
  const coordinator = createSessionCacheCoordinator({ fetchSession: async () => values.shift(), onChange: value => transitions.push(value) })
  for (let i = 0; i < 5; i++) await coordinator.refresh()
  assert.equal(new Set(transitions.slice(0, 4)).size, 4)
  assert.equal(transitions[4], '')
  assert.equal(validatedSessionScope({ ...session('A', '1'), policyVersion: null }), '')
  assert.equal(validatedSessionScope({ ...session('A', '1'), provider: 'legacy' }), '')
})
test('concurrent consumers share one verification and stale logout response cannot restore identity', async () => {
  let resolve
  let calls = 0
  const coordinator = createSessionCacheCoordinator({ fetchSession: () => { calls++; return new Promise(done => { resolve = done }) }, onChange() {} })
  const first = coordinator.refresh()
  const second = coordinator.refresh()
  assert.equal(first, second)
  await Promise.resolve()
  assert.equal(calls, 1)
  coordinator.invalidate()
  resolve(session('A', '1'))
  assert.equal(await first, '')
  assert.equal(coordinator.getScope(), '')
})
test('failed revalidation invalidates previously verified cache', async () => {
  let fail = false
  const coordinator = createSessionCacheCoordinator({ fetchSession: async () => { if (fail) throw Error('unavailable'); return session('A', '1') }, onChange() {} })
  assert.ok(await coordinator.refresh())
  fail = true
  await assert.rejects(coordinator.refresh(), /unavailable/)
  assert.equal(coordinator.getScope(), '')
})
test('login return preserves local module deep links and rejects external or recursive targets', () => {
  assert.equal(safeLoginRedirect('/aims/products/P1?tab=versions#v2'), '/aims/products/P1?tab=versions#v2')
  for (const input of ['https://evil.example', '//evil.example', '/%2fevil.example', '/\\evil', '/%5cevil', '/login', '/aims/login', '/assets/login', '/%0d%0aevil', null]) assert.equal(safeLoginRedirect(input), '/')
})

for (const replacementFinishesFirst of [false, true]) {
  test(`token renewal does not turn a superseded route check into logout (new first: ${replacementFinishesFirst})`, async () => {
    const resolvers = []
    const coordinator = createSessionCacheCoordinator({ fetchSession: () => new Promise(resolve => resolvers.push(resolve)), onChange() {} })
    const old = coordinator.refresh()
    await Promise.resolve()
    coordinator.invalidate()
    const current = coordinator.refresh()
    await Promise.resolve()
    const verified = session('B', '2', 'p2')
    if (replacementFinishesFirst) {
      resolvers[1](verified)
      await current
      resolvers[0](session('A', '1'))
    } else {
      resolvers[0](session('A', '1'))
      resolvers[1](verified)
    }
    assert.equal(await old, validatedSessionScope(verified))
    assert.equal(await current, validatedSessionScope(verified))
    assert.equal(coordinator.getScope(), validatedSessionScope(verified))
  })
}
test('replacement session rejection never reuses an older authenticated identity', async () => {
  const resolvers = []
  const coordinator = createSessionCacheCoordinator({ fetchSession: () => new Promise(resolve => resolvers.push(resolve)), onChange() {} })
  const old = coordinator.refresh()
  await Promise.resolve()
  coordinator.invalidate()
  const current = coordinator.refresh()
  await Promise.resolve()
  resolvers[0](session('A', '1'))
  resolvers[1]({ authenticated: false })
  assert.equal(await old, '')
  assert.equal(await current, '')
  assert.equal(coordinator.getScope(), '')
})

test('late module responses remain isolated from a replacement tenant and user', async () => {
  const cache = new Map()
  const scopeA = validatedSessionScope(session('tenant-a', 'user-a'))
  const scopeB = validatedSessionScope(session('tenant-b', 'user-b'))
  const key = scope => `hzy:enterprise:${scope}:assets:asset-categories-physical`
  let resolveA
  const requestA = new Promise(resolve => { resolveA = resolve }).then(value => cache.set(key(scopeA), value))
  cache.set(key(scopeB), ['tenant-b-category'])
  resolveA(['tenant-a-category'])
  await requestA

  assert.deepEqual(cache.get(key(scopeB)), ['tenant-b-category'])
  assert.deepEqual(cache.get(key(scopeA)), ['tenant-a-category'])
  assert.notEqual(key(scopeA), key(scopeB))
  assert.ok(isEnterpriseSessionCacheKey(key(scopeA)))
  assert.ok(isEnterpriseSessionCacheKey(key(scopeB)))
  assert.equal(isEnterpriseSessionCacheKey('asset-categories-physical'), false)
})

test('page identity only moves on verification results, not on invalidation', async () => {
  const verifiedTransitions = []
  let fail = false
  const coordinator = createSessionCacheCoordinator({
    fetchSession: async () => { if (fail) throw Error('unavailable'); return session('A', '1') },
    onChange() {},
    onVerified: value => verifiedTransitions.push(value)
  })
  const scopeA = validatedSessionScope(session('A', '1'))
  assert.equal(await coordinator.refresh(), scopeA)
  assert.deepEqual(verifiedTransitions, [scopeA])

  coordinator.invalidate()
  assert.deepEqual(verifiedTransitions, [scopeA], 'invalidation must not publish a transient identity')
  assert.equal(await coordinator.refresh(), scopeA)
  assert.deepEqual(verifiedTransitions, [scopeA], 'a rotation that keeps the identity publishes nothing new')

  fail = true
  await assert.rejects(coordinator.refresh(), /unavailable/)
  assert.deepEqual(verifiedTransitions, [scopeA, ''])
})

test('only a confirmed sign-out after an authenticated session counts as session loss', async () => {
  const responses = []
  let lost = 0
  const fetchSession = watchSessionLoss(async () => {
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next
  }, () => {
    lost++
  })
  responses.push({ authenticated: false })
  await fetchSession()
  assert.equal(lost, 0, 'a page that starts signed out is left to the route middleware')
  responses.push({ authenticated: true }, Error('auth check unavailable'), { authenticated: true })
  await fetchSession()
  await assert.rejects(fetchSession)
  await fetchSession()
  assert.equal(lost, 0, 'an unavailable check is not a sign-out')
  responses.push({ authenticated: false, refreshable: true })
  await fetchSession()
  assert.equal(lost, 0, 'an expired but refreshable access token is not a sign-out')
  responses.push({ authenticated: false }, { authenticated: false })
  await fetchSession()
  await fetchSession()
  assert.equal(lost, 1, 'reported once per transition')
})

test('the session plugin sends a confirmed sign-out to login with a return path', async () => {
  const source = (await import('node:fs')).readFileSync(new URL('../app/plugins/enterprise-session.client.ts', import.meta.url), 'utf8')
  assert.match(source, /fetchSession: watchSessionLoss\(async \(\) => \{/)
  assert.match(source, /const meUrl: string = `\$\{config\.public\.authApiPrefix \|\| ''\}\/api\/auth\/me`/)
  assert.match(source, /navigateTo\(\{ path: String\(config\.public\.enterpriseLoginPath \|\| '\/login'\), query: \{ redirect: current\.fullPath \} \}\)/)
  assert.match(source, /LOGIN_PATHS\.includes\(current\.path\)/)
})
