import test from 'node:test'
import assert from 'node:assert/strict'
import { createSessionCacheCoordinator, isEnterpriseSessionCacheKey, validatedSessionScope, safeLoginRedirect } from '../shared/session-cache.mjs'
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
