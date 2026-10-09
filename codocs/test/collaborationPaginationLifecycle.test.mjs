import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'

test('collaboration page uses server tab totals/options and isolates stale list/preview responses', async () => {
  const source = readFileSync(new URL('../app/pages/mydocs/shared.vue', import.meta.url), 'utf8')
  assert.match(source, /<UPagination[\s\S]*?:total="total"/)
  assert.match(source, /共 {{ total }} 条/)
  const script = stripTypeScriptTypes(source.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1].replace(/^import .*$/gm, '').replace(/\nvoid refresh\(\)\s*$/, ''))
  const calls = [], watches = [], disposed = [], user = { value: 'alice' }
  let viewer = 'alice-policy-1'
  const ref = value => ({ value })
  const run = new Function('env', `with(env) { ${script}; return {refresh,page,sharedTab,visibleItems,total,ownerOptions,deptOptions,loadPreview,previewContent,data}; }`)
  const ui = run({
    ref, computed: fn => ({ get value() { return fn() } }), definePageMeta() {}, usePageTitle() {},
    useAuth: () => ({ user }), useCodocsModule: () => ({ moduleUrl: x => `/codocs${x}`, documentUrl: x => x, cacheKey: () => viewer, hosted: true }),
    useRouter: () => ({ push() {} }), useAccountStore: () => ({ getUserByUid: () => undefined, getDepartmentById: () => undefined, fetchUsersBatch: async () => {}, fetchDepartments: async () => {} }),
    usePermissions: () => ({ hasPermission: () => false, loadPermissions: async () => {} }), useDocumentPreviewBootstrap: () => ({ setPayload() {} }), useResizablePanel: () => ({}),
    useDebouncedSearch: () => ({ search: ref(''), debounced: ref(''), flush() {}, reset() {} }), useListPage: () => ({ page: ref(2), pageSize: 20 }),
    watch: (target, fn) => watches.push({ target, fn }), onScopeDispose: fn => disposed.push(fn), AbortController,
    $fetch: (url, options) => new Promise(resolve => calls.push({ url, options, resolve }))
  })
  const pageData = { items: [{ uuid: 'D1', ownerUid: 'a', relationTypes: ['shared_to_me'] }], total: 41, page: 2, pageSize: 20, ownerUids: ['a', 'b'], deptCodes: ['D1', 'D2'] }
  const first = ui.refresh()
  assert.equal(calls[0].options.params.sharedTab, 'received')
  calls[0].resolve({ code: 0, data: pageData })
  await first
  assert.equal(ui.total.value, 41)
  assert.equal(ui.ownerOptions.value.length, 3)
  assert.equal(ui.deptOptions.value.length, 3)
  const stale = ui.refresh()
  ui.sharedTab.value = 'sent'
  calls[1].resolve({ code: 0, data: pageData })
  await stale
  assert.equal(ui.data.value, null)
  const list = ui.refresh()
  calls[2].resolve({ code: 0, data: pageData })
  await list
  const preview = ui.loadPreview('D1')
  user.value = null
  viewer = 'signed-out'
  await watches.find(w => typeof w.target === 'function').fn()
  assert.equal(calls[3].options.signal.aborted, true)
  calls[3].resolve({ success: true, data: { content: 'SECRET' } })
  await preview
  assert.equal(ui.previewContent.value, '')
  assert.equal(ui.data.value, null)
  await ui.refresh()
  assert.equal(calls.length, 4)
  disposed.forEach(fn => fn())
})

test('Host query changes and tab clicks stay reactive inside one synchronous effect scope', async () => {
  const vue = await import('vue')
  const route = vue.reactive({ query: { sharedTab: 'sent' } })
  const requests = []
  const warnings = []
  const oldWarn = console.warn
  console.warn = value => warnings.push(String(value))
  const scope = vue.effectScope()
  try {
    const listSource = readFileSync(new URL('../../foundation/app/composables/useListPage.ts', import.meta.url), 'utf8')
    const listScript = stripTypeScriptTypes(listSource.replace(/^import .*$/gm, '').replace('export function useListPage', 'function useListPage'))
    const router = { replace({ query }) {
      route.query = query
      return Promise.resolve()
    }, push() {} }
    const useListPage = new Function('env', `with(env) { ${listScript}; return useListPage }`)({ ...vue, useRoute: () => route, useRouter: () => router })
    const source = readFileSync(new URL('../app/pages/mydocs/shared.vue', import.meta.url), 'utf8')
    const script = stripTypeScriptTypes(source.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1].replace(/^import .*$/gm, ''))
    const run = new Function('env', `with(env) { ${script}; return {sharedTab,page,refresh} }`)
    const ui = scope.run(() => run({
      ...vue, definePageMeta() {}, usePageTitle() {}, useAuth: () => ({ user: vue.ref('fixture-member') }),
      useCodocsModule: () => ({ moduleUrl: x => `/codocs${x}`, documentUrl: x => x, cacheKey: () => 'fixture', hosted: true }),
      useRouter: () => router, useListPage,
      useAccountStore: () => ({ getUserByUid() {}, getDepartmentById() {}, async fetchUsersBatch() {}, async fetchDepartments() {} }),
      usePermissions: () => ({ hasPermission: () => false, async loadPermissions() {} }),
      useDocumentPreviewBootstrap: () => ({ setPayload() {} }), useResizablePanel: () => ({}),
      useDebouncedSearch: () => ({ search: vue.ref(''), debounced: vue.ref(''), flush() {}, reset() {} }), AbortController,
      async $fetch(_url, options) {
        requests.push(options.params)
        return { code: 0, data: { items: [], total: 0, page: options.params.page, pageSize: 20, ownerUids: [], deptCodes: [] } }
      }
    }))
    await vue.nextTick()
    assert.equal(ui.sharedTab.value, 'sent')
    assert.equal(requests.at(-1).sharedTab, 'sent')
    route.query = { sharedTab: 'received' }
    await vue.nextTick()
    await vue.nextTick()
    assert.equal(ui.sharedTab.value, 'received')
    assert.equal(requests.at(-1).sharedTab, 'received')
    ui.sharedTab.value = 'sent'
    await vue.nextTick()
    await vue.nextTick()
    assert.equal(route.query.sharedTab, 'sent')
    assert.equal(requests.at(-1).sharedTab, 'sent')
    scope.stop()
    assert.deepEqual(warnings, [])
  } finally {
    scope.stop()
    console.warn = oldWarn
  }
})

test('collaboration layout keeps pagination after the scrollable list and stacks on narrow content', () => {
  const source = readFileSync(new URL('../app/pages/mydocs/shared.vue', import.meta.url), 'utf8')
  assert.ok(source.indexOf('<UPagination') > source.indexOf('v-for="item in visibleItems"'))
  assert.match(source, /useResizablePanel\(384\)/)
  assert.match(source, /@3xl:w-\(--document-list-width\)/)
  assert.match(source, /返回列表/)
  assert.doesNotMatch(source, /^await refresh\(\)/m)
})
