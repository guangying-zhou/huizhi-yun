import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import { parse, compileScript } from '@vue/compiler-sfc'
import { createRenderer, defineComponent, h, nextTick, ref, watch } from 'vue'

const file = new URL('../app/app.vue', import.meta.url).pathname
const result = await build({
  entryPoints: [file], bundle: true, platform: 'node', format: 'cjs', write: false, external: ['vue'],
  plugins: [{ name: 'actual-app-template', setup(builder) {
    builder.onLoad({ filter: /\.vue$/ }, ({ path }) => ({
      contents: compileScript(parse(readFileSync(path, 'utf8'), { filename: path }).descriptor, { id: path, inlineTemplate: true }).content,
      loader: 'ts'
    }))
  } }]
})
const module = { exports: {} }
new Function('require', 'module', 'exports', result.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports)

test('compiled Host keeps pageKey callback stable while route and verified scope remain reactive', async () => {
  const scope = ref('verified-a')
  const route = ref({ path: '/aims/projects', query: {} })
  globalThis.useState = () => scope
  let loadingStarts = 0
  let currentKey
  let callback
  const Page = defineComponent({ props: ['pageKey'], setup(props) {
    // NuxtPage watches the callback reference, not just its returned key.
    watch(() => props.pageKey, () => loadingStarts++)
    return () => { callback = props.pageKey; currentKey = props.pageKey(route.value); return h('span') }
  } })
  const Pass = defineComponent({ setup: (_, { slots }) => () => h('div', slots.default?.()) })
  const renderer = createRenderer({
    patchProp() {}, insert() {}, remove() {}, createElement: type => ({ type }),
    createText: text => ({ text }), createComment: text => ({ text }),
    setText(node, text) { node.text = text }, setElementText(node, text) { node.text = text },
    parentNode: () => null, nextSibling: () => null
  })
  const app = renderer.createApp(module.exports.default)
  app.component('UApp', Pass).component('NuxtLayout', Pass).component('NuxtPage', Page)
  app.component('NuxtLoadingIndicator', defineComponent({ render: () => h('span') }))
  const root = app.mount({ type: 'root' })
  try {
    const initialCallback = callback
    const initialKey = currentKey
    assert.equal(JSON.parse(currentKey)[0], 'verified-a')
    for (let i = 0; i < 3; i++) { root.$forceUpdate(); await nextTick() }
    assert.equal(callback, initialCallback)
    assert.equal(loadingStarts, 0, 'parent renders must not start a phantom navigation')
    route.value = { path: '/aims/projects', query: { search: 'updated' } }
    await nextTick()
    assert.equal(currentKey, initialKey)
    scope.value = 'verified-b'
    await nextTick()
    assert.notEqual(currentKey, initialKey)
    assert.equal(JSON.parse(currentKey)[0], 'verified-b')
    assert.equal(callback, initialCallback)
    route.value = { path: '/assets/products', query: {} }
    await nextTick()
    assert.equal(JSON.parse(currentKey)[1], '/assets/products')
    assert.equal(loadingStarts, 0)
  } finally { app.unmount(); delete globalThis.useState }
})
