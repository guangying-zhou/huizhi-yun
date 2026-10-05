import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveNavigationAccess, filterNavigationAccess, filterWorkspaceAccess, createNavigationAccessLoader } from '../shared/navigation-access.mjs'

const leaf = (id, module = 'aims') => ({ id, module, permission: { resource: 'projects', action: 'view' } })
const items = [leaf('a'), leaf('b', 'assets')]
const navigation = { primary: [{ id: 'area', children: [{ id: 'group', children: items }] }], auxiliary: [] }

test('discovery keeps module authorization separate and a parent needs only one visible child', async () => {
  const loaded = []
  const ids = await resolveNavigationAccess(items, {
    available: true,
    load: async module => { loaded.push(module); return { allowed: module === 'aims' } },
    allows: snapshot => snapshot.allowed
  })
  assert.deepEqual(loaded.sort(), ['aims', 'assets'])
  assert.deepEqual(ids, ['a'])
  assert.deepEqual(filterNavigationAccess(navigation, ids).primary[0].children[0].children, [items[0]])
  assert.deepEqual(filterNavigationAccess(navigation, []), { primary: [], auxiliary: [] })
})

test('unavailable release/runtime and missing permission references fail closed', async () => {
  const options = { available: false, load: () => { throw Error('must not load') }, allows: () => true }
  assert.deepEqual(await resolveNavigationAccess(items, options), [])
  assert.deepEqual(await resolveNavigationAccess([{ id: 'bad', module: 'aims' }], { ...options, available: true, load: async () => ({}) }), [])
})

test('authorization outage is not misreported as no permission', async () => {
  await assert.rejects(resolveNavigationAccess(items, { available: true, load: async () => { throw Error('503') }, allows: () => true }), /503/)
})

test('object actions are filtered and empty object groups disappear', () => {
  const workspaces = [{ code: 'project', groups: [{ items }, { items: [leaf('edit')] }] }]
  assert.deepEqual(filterWorkspaceAccess(workspaces, ['a']), [{ code: 'project', groups: [{ items: [items[0]] }] }])
  assert.deepEqual(filterWorkspaceAccess(workspaces, []), [])
})

test('multi-resource pages require every permission unless explicitly any', async () => {
  const item = { id: 'plan', module: 'aims', permissionRefs: [{ resource: 'milestones', action: 'view' }, { resource: 'work_items', action: 'view' }] }
  const options = { available: true, load: async () => ({}), allows: (_, ref) => ref.resource === 'milestones' }
  assert.deepEqual(await resolveNavigationAccess([item], options), [])
  assert.deepEqual(await resolveNavigationAccess([{ ...item, mode: 'any' }], options), ['plan'])
})

test('logout and new tenant/policy reject late responses; failed refresh removes stale menus', async () => {
  const requests = []
  let published
  const loader = createNavigationAccessLoader({
    fetchAccess: signal => new Promise((resolve, reject) => requests.push({ resolve, reject, signal })),
    publish: (ids, status) => { published = { ids, status } }
  })
  const old = loader.refresh('tenant-a/user-1/policy-1')
  const current = loader.refresh('tenant-b/user-2/policy-2')
  assert.equal(requests[0].signal.aborted, true)
  requests[1].resolve({ visibleIds: ['b'], maxAgeMs: 60_000 })
  await current
  requests[0].resolve({ visibleIds: ['a'], maxAgeMs: 60_000 })
  await old
  assert.deepEqual(published, { ids: ['b'], status: 'ready' })
  const failed = loader.refresh('tenant-b/user-2/policy-2')
  assert.deepEqual(published, { ids: ['b'], status: 'refreshing' })
  requests[2].reject(Error('503'))
  await failed
  assert.deepEqual(published, { ids: [], status: 'error' })
  const pending = loader.refresh('tenant-b/user-2/policy-2')
  loader.clear()
  requests[3].resolve({ visibleIds: ['b'], maxAgeMs: 60_000 })
  await pending
  assert.deepEqual(published, { ids: [], status: 'idle' })
})

test('same-scope refresh keeps workspace and reference; confirmed revocation clears it', async () => {
  let resolve
  let state
  const loader = createNavigationAccessLoader({ fetchAccess: () => new Promise(done => { resolve = done }), publish: (ids, status) => { state = { ids, status } } })
  const first = loader.refresh('verified-a')
  resolve({ visibleIds: ['a'], maxAgeMs: 60_000 }); await first
  const ids = state.ids
  const second = loader.refresh('verified-a')
  assert.equal(state.ids, ids)
  assert.equal(filterWorkspaceAccess([{ groups: [{ items }] }], state.ids).length, 1)
  resolve({ visibleIds: ['a'], maxAgeMs: 60_000 }); await second
  assert.equal(state.ids, ids)
  const revoked = loader.refresh('verified-a')
  resolve({ visibleIds: [], maxAgeMs: 60_000 }); await revoked
  assert.deepEqual(state.ids, [])
  loader.clear()
})

test('old lease expiry hides menu without cancelling a newer validated refresh', async () => {
  let time = 0, expire, state
  const requests = []
  const loader = createNavigationAccessLoader({
    now: () => time, schedule: (fn) => { expire = fn; return 1 }, cancel: () => {},
    fetchAccess: signal => new Promise((resolve, reject) => requests.push({ resolve, reject, signal })),
    publish: (ids, status) => { state = { ids, status } }
  })
  const first = loader.refresh('a'); requests[0].resolve({ visibleIds: ['a'], maxAgeMs: 100 }); await first
  time = 50
  const pending = loader.refresh('a')
  assert.equal(state.status, 'refreshing')
  time = 100; expire()
  assert.deepEqual(state, { ids: [], status: 'expired' })
  assert.equal(requests[1].signal.aborted, false)
  time = 120
  requests[1].resolve({ visibleIds: ['a'], maxAgeMs: 100 }); await pending
  assert.deepEqual(state, { ids: ['a'], status: 'ready' })
  time = 150; expire()
  assert.deepEqual(state, { ids: [], status: 'expired' })
  const retry = loader.refresh('a'); requests[2].reject(Error('503')); await retry
  assert.deepEqual(state, { ids: [], status: 'error' })
  const slow = loader.refresh('a'); time = 300
  requests[3].resolve({ visibleIds: ['a'], maxAgeMs: 100 }); await slow
  assert.deepEqual(state, { ids: [], status: 'error' })
  loader.clear()
})

test('scope changes clear immediately; invalid leases fail closed', async () => {
  let resolve, state
  const loader = createNavigationAccessLoader({ fetchAccess: () => new Promise(done => { resolve = done }), publish: (ids, status) => { state = { ids, status } } })
  let pending = loader.refresh('a'); resolve({ visibleIds: ['a'], maxAgeMs: 60_000 }); await pending
  pending = loader.refresh('b'); assert.deepEqual(state.ids, [])
  resolve({ visibleIds: ['b'] }); await pending
  assert.equal(state.status, 'error')
  loader.clear()
})

test('same-scope timer, focus and route refreshes share a slow request', async () => {
  let time = 0, state
  const requests = []
  const loader = createNavigationAccessLoader({
    now: () => time,
    fetchAccess: signal => new Promise(resolve => requests.push({ signal, resolve })),
    publish: (ids, status) => { state = { ids, status } },
    schedule: () => 1,
    cancel: () => {}
  })
  const first = loader.refresh('tenant/user/policy')
  time = 30_000
  const timer = loader.refresh('tenant/user/policy')
  const focus = loader.refresh('tenant/user/policy')
  const route = loader.refresh('tenant/user/policy')
  assert.equal(requests.length, 1)
  assert.equal(requests[0].signal.aborted, false)
  time = 35_000
  requests[0].resolve({ visibleIds: ['a'], maxAgeMs: 60_000 })
  await Promise.all([first, timer, focus, route])
  assert.deepEqual(state, { ids: ['a'], status: 'ready' })
  loader.clear()
})

test('context switch aborts the shared request and rejects its late result', async () => {
  const requests = []
  let state
  const loader = createNavigationAccessLoader({
    fetchAccess: signal => new Promise(resolve => requests.push({ signal, resolve })),
    publish: (ids, status) => { state = { ids, status } },
    schedule: () => 1, cancel: () => {}
  })
  const first = loader.refresh('tenant-a/user-a')
  const joined = loader.refresh('tenant-a/user-a')
  const switched = loader.refresh('tenant-b/user-b')
  assert.equal(requests.length, 2)
  assert.equal(requests[0].signal.aborted, true)
  requests[0].resolve({ visibleIds: ['old'], maxAgeMs: 60_000 })
  await Promise.all([first, joined])
  assert.deepEqual(state.ids, [])
  requests[1].resolve({ visibleIds: ['new'], maxAgeMs: 60_000 })
  await switched
  assert.deepEqual(state, { ids: ['new'], status: 'ready' })
  loader.clear()
})

test('synchronous fetch failure clears the in-flight slot for a later retry', async () => {
  let calls = 0, state
  const loader = createNavigationAccessLoader({
    fetchAccess: () => {
      if (++calls === 1) throw Error('offline')
      return Promise.resolve({ visibleIds: ['recovered'], maxAgeMs: 60_000 })
    },
    publish: (ids, status) => { state = { ids, status } },
    schedule: () => 1, cancel: () => {}
  })
  await loader.refresh('tenant/user')
  assert.equal(state.status, 'error')
  await loader.refresh('tenant/user')
  assert.equal(calls, 2)
  assert.deepEqual(state, { ids: ['recovered'], status: 'ready' })
  loader.clear()
})
