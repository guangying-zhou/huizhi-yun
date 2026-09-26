import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve, dirname } from 'node:path'
import { build } from 'esbuild'
import { parse, compileScript } from '@vue/compiler-sfc'
import { ref, computed, reactive } from 'vue'
import * as shell from '../../foundation/app/utils/applicationShell.ts'

const file = resolve(import.meta.dirname, '../../console/app/pages/shell/[appCode].vue')
const content = compileScript(parse(readFileSync(file, 'utf8'), { filename: file }).descriptor, { id: 'console-shell' }).content
const bundle = (await build({ stdin: { contents: content, sourcefile: file, loader: 'ts', resolveDir: dirname(file) }, bundle: true, platform: 'node', format: 'cjs', write: false, external: ['vue'], define: { 'import.meta.client': 'true' } })).outputFiles[0].text
const module = { exports: {} }
new Function('require', 'module', 'exports', bundle)(createRequire(import.meta.url), module, module.exports)

function harness() {
  const route = reactive({ params: { appCode: 'aims' }, query: { target: '/aims/projects/1' } })
  const calls = [], navigations = []
  Object.assign(globalThis, shell, {
    ref, computed, definePageMeta: () => {}, useRoute: () => route,
    useUserApplications: () => ({ apps: ref([{ appCode: 'aims', appName: '项目', homeUrl: 'https://tenant.example/aims/', basePath: '/aims/' }]), loaded: ref(true), loading: ref(false), loadApps: async () => {} }),
    watch: () => {}, onMounted: () => {}, onBeforeUnmount: () => {}, useHead: () => {},
    window: { location: { origin: 'https://tenant.example', replace: value => navigations.push(value) } },
    $fetch: (url, options) => new Promise((resolve, reject) => calls.push({ url, options, resolve, reject }))
  })
  return { route, calls, navigations, page: module.exports.default.setup({}, { expose: () => {} }) }
}
const settle = async () => { await new Promise(resolve => setImmediate(resolve)) }

test('real Console SFC activation navigates migrated pages, never navigates on hover, and retains unmigrated iframe behavior', async () => {
  const h = harness()
  let pending = h.page.prewarmApplication('aims'); await settle()
  h.calls[0].resolve({ migrated: true, target: '/aims/projects' }); await pending
  assert.deepEqual(h.navigations, [])
  assert.equal(h.page.frames.value.length, 0)
  pending = h.page.activateRouteFrame(); await settle()
  h.calls[1].resolve({ migrated: true, target: '/aims/projects/1?tab=x#part' }); await pending
  assert.deepEqual(h.navigations, ['/aims/projects/1?tab=x#part'])
  assert.equal(h.page.frames.value.length, 0)
  h.route.query.target = '/aims/legacy'
  pending = h.page.activateRouteFrame(); await settle()
  h.calls[2].resolve({ migrated: false }); await pending
  assert.equal(h.page.frames.value.length, 1)
  assert.match(h.page.frames.value[0].src, /aims\/legacy\?hzy_embed=1/)
})

test('real Console SFC rejects same-app late activations and retries a failed migration check without creating an iframe', async () => {
  const h = harness()
  const old = h.page.activateRouteFrame(); await settle()
  h.route.query.target = '/aims/projects/2'
  const latest = h.page.activateRouteFrame(); await settle()
  h.calls[1].resolve({ migrated: true, target: '/aims/projects/2' }); await latest
  h.calls[0].resolve({ migrated: true, target: '/aims/projects/1' }); await old
  assert.deepEqual(h.navigations, ['/aims/projects/2'])
  let pending = h.page.activateRouteFrame(); await settle()
  h.calls[2].reject(Error('unavailable')); await pending
  assert.equal(h.page.migrationError.value, true)
  assert.equal(h.page.frames.value.length, 0)
  pending = h.page.activateRouteFrame(); await settle()
  h.calls[3].resolve({ migrated: true, target: '/aims/projects/2' }); await pending
  assert.equal(h.page.migrationError.value, false)
  assert.equal(h.navigations.length, 2)
})
