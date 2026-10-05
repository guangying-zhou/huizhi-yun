import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse, compileScript } from '@vue/compiler-sfc'
import { buildSync } from 'esbuild'
import { createRequire } from 'node:module'
import { createRenderer, ref, computed, watch, onMounted, onScopeDispose, nextTick } from 'vue'

const file = new URL('../app/components/AltocBasicReadPage.vue', import.meta.url).pathname
const source = readFileSync(file, 'utf8')
const { descriptor } = parse(source, { filename: file })
const script = compileScript(descriptor, { id: 'altoc-read-test' })
const code = buildSync({ stdin: { contents: script.content, sourcefile: file, resolveDir: new URL('../app/components/', import.meta.url).pathname, loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', write: false, external: ['vue'], define: { 'import.meta.client': 'false' } }).outputFiles[0].text
const module = { exports: {} }
new Function('require', 'module', 'exports', code)(createRequire(import.meta.url), module, module.exports)

test('Altoc page clears data on identity/policy changes and rejects late replies after logout or unmount', async () => {
 const scope = ref('tenant-a/person-a/policy-a'), access = ref('ready'), requests = []
 const route = { fullPath: '/altoc/customers', params: {}, query: {} }
 const globals = { ref, computed, watch, onMounted, onScopeDispose, useRoute: () => route, useRouter: () => ({ push: async () => {} }), useUserApplications: () => ({ apps: ref([]), loadApps: async () => {} }), useEnterpriseNavigationAccess: () => ({ status: access }), useState: () => scope, $fetch: (url, options) => new Promise(resolve => requests.push({ url, options, resolve })) }
 const previous = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
 Object.assign(globalThis, globals)
 const renderer = createRenderer({ patchProp() {}, insert() {}, remove() {}, createElement: type => ({ type }), createText: text => ({ text }), createComment: text => ({ text }), setText() {}, setElementText() {}, parentNode: () => null, nextSibling: () => null })
 const component = module.exports.default
 let state
 component.render = () => null
 const originalSetup = component.setup
 component.setup = (props, context) => { state = originalSetup(props, context); return state }
 const app = renderer.createApp(component, { resource: 'customer', title: '客户' })
 const settle = async () => { await nextTick(); await new Promise(done => setImmediate(done)) }
 try {
  app.mount({ type: 'root' }); assert.equal(requests.length, 1)
  requests[0].resolve({ code: 0, data: { items: [{ id: 7, name: 'visible' }], total: 1 } }); await settle()
  assert.equal(state.data.value.items[0].name, 'visible')
  scope.value = 'tenant-a/person-b/policy-a'
  assert.equal(state.data.value, null); assert.equal(requests.length, 2)
  scope.value = ''
  assert.equal(requests[1].options.signal.aborted, true)
  requests[1].resolve({ code: 0, data: { items: [{ name: 'late-secret' }] } }); await settle()
  assert.equal(state.data.value, null)
  scope.value = 'tenant-a/person-b/policy-b'; assert.equal(requests.length, 3)
  access.value = 'loading'
  assert.equal(requests[2].options.signal.aborted, true); assert.equal(state.data.value, null)
  requests[2].resolve({ code: 0, data: { items: [{ name: 'revoked-secret' }] } }); await settle(); assert.equal(state.data.value, null)
  access.value = 'ready'; assert.equal(requests.length, 4)
  app.unmount(); assert.equal(requests[3].options.signal.aborted, true)
  requests[3].resolve({ code: 0, data: { items: [{ name: 'unmounted-secret' }] } }); await settle(); assert.equal(state.data.value, null)
  assert.match(source, /<ContentPageHeader[^>]+hosted/)
  assert.ok(!/\$fetch[^;]+method:\s*['"](?:POST|PATCH|PUT|DELETE)/s.test(source))
 } finally {
  app.unmount()
  for (const [key, property] of previous) { if (property) Object.defineProperty(globalThis, key, property); else delete globalThis[key] }
 }
})

for (const resource of ['lead','opportunity','quotation']) test(`Altoc ${resource} clears data on identity/policy changes and rejects late replies after logout or unmount`, async () => {
 const scope = ref('tenant-a/person-a/policy-a'), access = ref('ready'), requests = []
 const folder = resource === 'lead' ? 'leads' : resource === 'opportunity' ? 'opportunities' : 'quotes'
 const route = { fullPath: `/altoc/${folder}`, params: {}, query: {} }
 const globals = { ref, computed, watch, onMounted, onScopeDispose, useRoute: () => route, useRouter: () => ({ push: async () => {} }), useUserApplications: () => ({ apps: ref([]), loadApps: async () => {} }), useEnterpriseNavigationAccess: () => ({ status: access }), useState: () => scope, $fetch: (url, options) => new Promise(resolve => requests.push({ url, options, resolve })) }
 const previous = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
 Object.assign(globalThis, globals)
 const renderer = createRenderer({ patchProp() {}, insert() {}, remove() {}, createElement: type => ({ type }), createText: text => ({ text }), createComment: text => ({ text }), setText() {}, setElementText() {}, parentNode: () => null, nextSibling: () => null })
 const component = module.exports.default
 let state
 component.render = () => null
 const originalSetup = component.setup
 component.setup = (props, context) => { state = originalSetup(props, context); return state }
 const app = renderer.createApp(component, { resource, title: '经营资料' })
 const settle = async () => { await nextTick(); await new Promise(done => setImmediate(done)) }
 try {
  app.mount({ type: 'root' }); assert.equal(requests.length, 1); assert.equal(requests[0].url, `/altoc/api/v1/${folder}`)
  requests[0].resolve({ code: 0, data: { items: [{ id: 7, name: 'visible' }], total: 1 } }); await settle()
  assert.equal(state.data.value.items[0].name, 'visible')
  scope.value = 'tenant-a/person-b/policy-a'
  assert.equal(state.data.value, null); assert.equal(requests.length, 2)
  scope.value = ''
  assert.equal(requests[1].options.signal.aborted, true)
  requests[1].resolve({ code: 0, data: { items: [{ name: 'late-secret' }] } }); await settle()
  assert.equal(state.data.value, null)
  scope.value = 'tenant-a/person-b/policy-b'; assert.equal(requests.length, 3)
  access.value = 'loading'
  assert.equal(requests[2].options.signal.aborted, true); assert.equal(state.data.value, null)
  requests[2].resolve({ code: 0, data: { items: [{ name: 'revoked-secret' }] } }); await settle(); assert.equal(state.data.value, null)
  access.value = 'ready'; assert.equal(requests.length, 4)
  app.unmount(); assert.equal(requests[3].options.signal.aborted, true)
  requests[3].resolve({ code: 0, data: { items: [{ name: 'unmounted-secret' }] } }); await settle(); assert.equal(state.data.value, null)
  assert.match(source, /<ContentPageHeader[^>]+hosted/)
  assert.ok(!/\$fetch[^;]+method:\s*['"](?:POST|PATCH|PUT|DELETE)/s.test(source))
 } finally {
  app.unmount()
  for (const [key, property] of previous) { if (property) Object.defineProperty(globalThis, key, property); else delete globalThis[key] }
 }
})
