import test from 'node:test'
import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { createRequire } from 'node:module'
import { createRenderer, defineComponent, h, ref, computed, watch, onMounted, onScopeDispose, nextTick } from 'vue'

const bundle = buildSync({
  entryPoints: [new URL('../app/composables/useEnterpriseNavigationAccess.ts', import.meta.url).pathname],
  bundle: true, platform: 'node', format: 'cjs', write: false,
  external: ['vue'], define: { 'import.meta.client': 'true' }
}).outputFiles[0].text
const module = { exports: {} }
new Function('require', 'module', 'exports', bundle)(createRequire(import.meta.url), module, module.exports)
const { useEnterpriseNavigationAccess } = module.exports

test('layout and page share one navigation lease and identity invalidation', async () => {
  const scope = ref('tenant-a/user-a/policy-a')
  const route = { path: '/enterprise' }
  const requests = []
  const listeners = new Set()
  const globals = {
    ref, computed, watch, onMounted, onScopeDispose,
    useState: () => scope, useRoute: () => route,
    useNuxtApp: () => ({ $enterpriseSession: { refresh: async () => scope.value }, runWithContext: fn => fn() }),
    useRuntimeConfig: () => ({ public: { enterpriseLoginPath: '/enterprise/login' } }),
    navigateTo: () => { throw Error('unexpected login redirect') },
    $fetch: (_, options) => new Promise(resolve => requests.push({ resolve, signal: options.signal })),
    window: { addEventListener: (_, fn) => listeners.add(fn), removeEventListener: (_, fn) => listeners.delete(fn) }
  }
  const previous = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  Object.assign(globalThis, globals)
  let layoutAccess, pageAccess
  const childVisible = ref(true)
  const Page = defineComponent({ setup() { pageAccess = useEnterpriseNavigationAccess(); return () => h('span') } })
  const Layout = defineComponent({ setup() {
    layoutAccess = useEnterpriseNavigationAccess()
    return () => h('div', childVisible.value ? [h(Page)] : [])
  } })
  const renderer = createRenderer({
    patchProp() {}, insert() {}, remove() {}, createElement: type => ({ type }),
    createText: text => ({ text }), createComment: text => ({ text }),
    setText(node, text) { node.text = text }, setElementText(node, text) { node.text = text },
    parentNode: () => null, nextSibling: () => null
  })
  const app = renderer.createApp(Layout)
  const settle = async () => { await nextTick(); await new Promise(resolve => setImmediate(resolve)) }
  try {
    app.mount({ type: 'root' })
    assert.equal(pageAccess, layoutAccess)
    assert.equal(requests.length, 1)
    assert.equal(listeners.size, 1)
    requests[0].resolve({ visibleIds: [], maxAgeMs: 60_000 })
    await settle()
    assert.equal(pageAccess.status.value, 'ready')
    childVisible.value = false; await settle()
    childVisible.value = true; await settle()
    assert.equal(requests.length, 1, 'page remount retains the layout-owned lease')
    assert.equal(pageAccess, layoutAccess)
    scope.value = 'tenant-b/user-b/policy-b'
    assert.equal(pageAccess.status.value, 'loading')
    assert.equal(requests.length, 2)
    scope.value = ''
    assert.equal(requests[1].signal.aborted, true)
    assert.equal(pageAccess.status.value, 'idle')
    requests[1].resolve({ visibleIds: [], maxAgeMs: 60_000 }); await settle()
    assert.equal(pageAccess.status.value, 'idle', 'late data cannot restore an invalid identity')
  } finally {
    app.unmount()
    assert.equal(listeners.size, 0)
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  }
})

test('a navigation 401 prompts one session check and never redirects by itself', async () => {
  const scope = ref('tenant-a/user-a/policy-a')
  const route = { path: '/enterprise/aims/projects', fullPath: '/enterprise/aims/projects?tab=all' }
  const redirects = []
  let checks = 0
  const session = async () => {
    checks++
    return ''
  }
  const globals = {
    ref, computed, watch, onMounted, onScopeDispose,
    useState: () => scope, useRoute: () => route,
    useNuxtApp: () => ({ $enterpriseSession: { refresh: () => session() } }),
    useRuntimeConfig: () => ({ public: { enterpriseLoginPath: '/enterprise/login' } }),
    navigateTo: (target) => {
      redirects.push(target)
    },
    $fetch: async () => {
      throw Object.assign(Error('Unauthorized'), { statusCode: 401 })
    },
    window: { addEventListener() {}, removeEventListener() {} }
  }
  const previous = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  Object.assign(globalThis, globals)
  const renderer = createRenderer({
    patchProp() {}, insert() {}, remove() {}, createElement: type => ({ type }),
    createText: text => ({ text }), createComment: text => ({ text }),
    setText(node, text) {
      node.text = text
    },
    setElementText(node, text) {
      node.text = text
    },
    parentNode: () => null, nextSibling: () => null
  })
  let access
  const app = renderer.createApp(defineComponent({
    setup() {
      access = useEnterpriseNavigationAccess()
      return () => h('span')
    }
  }))
  const settle = async () => {
    for (let i = 0; i < 4; i++) {
      await nextTick()
      await new Promise(resolve => setImmediate(resolve))
    }
  }
  try {
    app.mount({ type: 'root' })
    await settle()
    assert.equal(access.status.value, 'error')
    assert.equal(checks, 1)
    await access.refresh()
    await settle()
    assert.equal(checks, 2)
    assert.deepEqual(redirects, [], 'the session plugin, not navigation, decides to leave for login')
  } finally {
    app.unmount()
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  }
})
