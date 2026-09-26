import test from 'node:test'
import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { reactive, ref, computed, watch, onScopeDispose, effectScope, nextTick, isRef } from 'vue'
import { createNavigationAccessLoader, filterWorkspaceAccess } from '../shared/navigation-access.mjs'

const root = resolve(dirname(new URL(import.meta.url).pathname), '..')
const source = resolve(root, 'app/composables/useEnterpriseProjectObjectContext.ts')
const bundled = buildSync({ entryPoints: [source], bundle: true, format: 'cjs', platform: 'node', write: false, sourcemap: false }).outputFiles[0].text
const loaded = { exports: {} }
new Function('require', 'module', 'exports', bundled)(createRequire(import.meta.url), loaded, loaded.exports)
const { useEnterpriseProjectObjectContext } = loaded.exports

function harness(workspaceInput) {
  const route = reactive({ name: 'aims-project-detail', path: '/aims/projects/1', params: { id: '1' }, query: {}, matched: [{ name: 'aims-project-detail', path: '/aims/projects/:id' }] })
  const scope = ref('')
  const store = new Map()
  const calls = []
  const globals = { useRoute: () => route, useState: (key, init) => store.has(key) ? store.get(key) : (store.set(key, ref(init())), store.get(key)), toValue: value => isRef(value) ? value.value : typeof value === 'function' ? value() : value, $fetch: (url, options) => new Promise((resolve, reject) => calls.push({ url, options, resolve, reject })), useAimsModule: () => ({ moduleUrl: value => `/aims${value}` }) }
  for (const [key, value] of Object.entries(globals)) globalThis[key] = value
  globalThis.ref = ref; globalThis.computed = computed; globalThis.watch = watch; globalThis.onScopeDispose = onScopeDispose
  globalThis.useState = (key, init) => key === 'enterprise-cache-scope' ? scope : globals.useState(key, init)
  const workspace = workspaceInput || ref({ base: '/aims/projects/:id', backTo: '/aims/projects', groups: [{ id: 'overview', label: '概览', items: [{ id: 'overview', label: '概览', path: '', permission: { resource: 'projects', action: 'view' } }] }] })
  let context
  const scopeHandle = effectScope()
  scopeHandle.run(() => { context = useEnterpriseProjectObjectContext({ workspace }) })
  return { route, scope, calls, context, stop: () => scopeHandle.stop(), resolve: (index, value) => calls[index]?.resolve({ code: 0, data: value }), reject: (index, error = new Error('failed')) => calls[index]?.reject(error) }
}

async function settle() { await nextTick(); await new Promise(resolve => setImmediate(resolve)) }

test('requests only begin after verified scope and formal route', { concurrency: false }, async () => {
  const invalid = harness()
  invalid.route.name = 'aims-project-new'; invalid.route.matched = [{ name: 'aims-project-new', path: '/aims/projects/new' }]
  invalid.scope.value = 'verified-session'; await settle()
  assert.equal(invalid.calls.length, 0)
  invalid.stop()
  const h = harness(); assert.equal(h.calls.length, 0)
  assert.equal(h.context.active.value, false)
  h.scope.value = 'verified-session'
  assert.equal(h.context.active.value, true)
  await settle()
  assert.equal(h.calls.length, 1)
  assert.match(h.calls[0].url, /projects\/1$/)
  h.stop()
})

test('id changes refresh and stale detail/list responses cannot win', { concurrency: false }, async () => {
  const h = harness(); h.scope.value = 'verified-session'; await settle()
  h.resolve(0, { id: 1, name: '旧项目', canAccess: true }); await settle()
  assert.equal(h.calls.length, 2)
  h.route.params.id = '2'; h.route.path = '/aims/projects/2'; await settle()
  assert.equal(h.calls.filter(item => /projects\/2$/.test(item.url)).length, 1)
  h.route.params.id = '3'; h.route.path = '/aims/projects/3'; await settle()
  h.resolve(2, { id: 2, name: '迟到项目', canAccess: true })
  h.resolve(3, { id: 3, name: '新项目', canAccess: true }); await settle()
  assert.equal(h.context.model.value.label, '新项目')

  const listStart = h.calls.length
  void h.context.refreshProjects(1, 'a'); void h.context.refreshProjects(1, 'b'); await settle()
  const listCalls = h.calls.slice(listStart).filter(item => item.url.endsWith('/projects'))
  assert.equal(listCalls.length, 2)
  listCalls[1].resolve({ code: 0, data: { items: [{ id: 9, name: 'Beta' }], total: 1, page: 1, pageSize: 20 } })
  listCalls[0].resolve({ code: 0, data: { items: [{ id: 8, name: 'Alpha' }], total: 1, page: 1, pageSize: 20 } })
  await settle()
  assert.deepEqual(h.context.model.value.projects.map(item => item.name), ['Beta'])
  h.stop()
})

test('logout clears old object name synchronously and failed refresh clears stale model', { concurrency: false }, async () => {
  const h = harness(); h.scope.value = 'verified-session'; await settle()
  h.resolve(0, { id: 1, name: '当前项目', canAccess: true }); await settle()
  assert.equal(h.context.model.value.label, '当前项目')
  h.scope.value = ''; await nextTick()
  assert.equal(h.context.model.value, null)
  h.scope.value = 'verified-session'; await settle()
  const request = h.calls.at(-1); request.reject(new Error('unavailable')); await settle()
  assert.equal(h.context.model.value, null)
  const beforeForce = h.calls.length
  void h.context.refresh(); await settle()
  assert.equal(h.calls.length, beforeForce + 1)
  h.calls.at(-1).reject(new Error('force refresh failed')); await settle()
  assert.equal(h.context.model.value, null)
  h.stop()
})

test('mismatched detail ids are rejected and never rendered', { concurrency: false }, async () => {
  const h = harness(); h.scope.value = 'verified-session'; await settle()
  h.resolve(0, { id: 99, name: '错误对象', canAccess: true }); await settle()
  assert.equal(h.context.model.value, null)
  h.stop()
})

test('real Vue object lifecycle preserves search/page across soft nav refresh and child routes, but clears on revocation/expiry', { concurrency: false }, async () => {
  const visible = ref([])
  const catalog = [{ base: '/aims/projects/:id', groups: [{ id: 'overview', label: '概览', items: [{ id: 'overview', label: '概览', path: '' }, { id: 'board', label: '看板', path: '/board' }] }] }]
  const workspace = computed(() => filterWorkspaceAccess(catalog, visible.value)[0])
  const h = harness(workspace)
  let resolveAccess, expire, time = 0
  const loader = createNavigationAccessLoader({
    fetchAccess: () => new Promise(resolve => { resolveAccess = resolve }),
    publish: ids => { visible.value = ids },
    now: () => time, schedule: callback => { expire = callback; return 1 }, cancel: () => {}
  })
  h.scope.value = 'verified'
  let pending = loader.refresh('verified')
  resolveAccess({ visibleIds: ['overview'], maxAgeMs: 60_000 }); await pending; await settle()
  h.resolve(0, { id: 1, name: '稳定项目', canAccess: true }); await settle()
  h.resolve(1, { items: [], total: 40 }); await settle()
  void h.context.refreshProjects(2, 'Alpha')
  h.resolve(2, { items: [{ id: 2, name: 'Alpha' }], total: 40 }); await settle()
  const callCount = h.calls.length
  for (const path of ['/aims/projects/1/plan', '/aims/projects/1/board']) {
    h.route.path = path
    pending = loader.refresh('verified')
    await settle()
    assert.equal(h.context.model.value.label, '稳定项目')
    assert.equal(h.context.model.value.projectsPage, 2)
    assert.equal(h.context.model.value.projectsSearch, 'Alpha')
    resolveAccess({ visibleIds: ['overview'], maxAgeMs: 60_000 }); await pending; await settle()
    assert.equal(h.calls.length, callCount, 'background refresh must not reload project detail or list')
  }
  pending = loader.refresh('verified')
  resolveAccess({ visibleIds: ['board'], maxAgeMs: 60_000 }); await pending; await settle()
  assert.ok(workspace.value, 'other actions may remain available after projects:view revocation')
  assert.equal(h.context.model.value, null, 'confirmed revocation clears object synchronously')
  pending = loader.refresh('verified')
  resolveAccess({ visibleIds: ['overview'], maxAgeMs: 60_000 }); await pending; await settle()
  const late = h.calls.at(-1)
  time = 60_000; expire()
  late.resolve({ code: 0, data: { id: 1, name: '迟到项目', canAccess: true } }); await settle()
  assert.equal(h.context.model.value, null, 'expired visibility cannot be revived by a late object response')
  loader.clear(); h.stop()
})
