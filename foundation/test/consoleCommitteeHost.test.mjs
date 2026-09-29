import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import { createSSRApp, defineComponent, h, ref, computed, watch, onMounted } from 'vue'
import { renderToString } from '@vue/server-renderer'

const root = new URL('../../', import.meta.url)
const read = path => readFileSync(new URL(path, root), 'utf8')
async function page(path) {
  const result = await build({
    entryPoints: [new URL(path, root).pathname], bundle: true, platform: 'node', format: 'cjs', write: false, external: ['vue'], define: { 'import.meta.client': 'false' },
    plugins: [{ name: 'shared-portal-sfc', setup(builder) {
      builder.onLoad({ filter: /\.vue$/ }, ({ path }) => {
        const { descriptor, errors } = parse(readFileSync(path, 'utf8'), { filename: path })
        assert.deepEqual(errors, [])
        if (descriptor.script || descriptor.scriptSetup) {
          return { contents: compileScript(descriptor, { id: path, inlineTemplate: true }).content, loader: 'ts' }
        }
        const template = compileTemplate({ source: descriptor.template.content, filename: path, id: path })
        assert.deepEqual(template.errors, [])
        return { contents: `${template.code}\nexport default { render }`, loader: 'ts' }
      })
    } }]
  })
  const module = { exports: {} }
  new Function('require', 'module', 'exports', result.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports)
  return module.exports.default
}


test('Host committees gates management controls on server Console edit permission and hides stale data on failure', async () => {
  const state = { edit: false, error: null }
  const mocks = { ref, reactive: undefined, computed, watch: () => {}, usePageTitle: () => {}, useDebouncedSearch: () => ({ search: ref(''), debounced: ref(''), flush: () => {}, reset: () => {} }), useListPage: () => ({ page: ref(1), pageSize: 20, resetFilters: () => {} }), useToast: () => ({ add: () => {} }), useConfirm: () => ({ confirm: async () => false }), useFetch: async () => ({ data: ref({ code: 0, canEdit: state.edit, data: { items: [{ committeeCode: 'C1', name: '测试委员会', status: 'active', memberCount: 1 }], tree: [{ committeeCode: 'C1', name: '测试委员会', status: 'active', memberCount: 1 }], flat: [{ committeeCode: 'C1', name: '测试委员会', status: 'active', memberCount: 1 }] } }), pending: ref(false), error: ref(state.error), refresh: async () => {}, execute: async () => {}, clear: () => {} }) }
  mocks.reactive = (await import('vue')).reactive
  const previous = Object.fromEntries(Object.keys(mocks).map(key => [key, globalThis[key]]))
  Object.assign(globalThis, mocks)
  try {
    const component = await page('foundation/app/components/DirectoryCommitteesReadPage.vue')
    const editor = await page('foundation/app/components/DirectoryCommitteeEditor.vue')
    const table = await page('foundation/app/components/DirectoryCommitteesTable.vue')
    async function render() {
      const app = createSSRApp(component, { apiPath: '/enterprise/api/directory/committees', consolePath: '/console/directory/committees' })
      const box = defineComponent({ setup: (_, { slots }) => () => h('div', [slots.body?.(), slots.actions?.(), slots.default?.()]) })
      app.component('DirectoryCommitteeEditor', editor).component('DirectoryCommitteesTable', table)
      app.component('UDashboardPanel', box)
      app.component('UButton', defineComponent({ props: ['label', 'to'], setup: (props, { slots }) => () => h('a', { href: props.to }, [props.label, slots.default?.()]) }))
      app.component('UBadge', box)
      app.component('UTable', defineComponent({ props: ['data', 'columns'], setup: props => () => h('table', props.data.map(original => h('tr', props.columns.map(column => h('td', column.cell ? column.cell({ row: { original } }) : original[column.accessorKey]))))) }))
      for (const name of ['USlideover', 'UInput', 'UPagination', 'USkeleton', 'UFormField', 'USelect', 'UTextarea']) app.component(name, defineComponent({ inheritAttrs: false, setup: () => () => h('div') }))
      for (const name of ['CommonEmptyState', 'UAlert']) app.component(name, defineComponent({ props: ['title', 'description'], setup: props => () => h('p', [props.title, props.description]) }))
      return renderToString(app)
    }
    assert.match(read('console/app/pages/directory/committees.vue'), /<DirectoryCommitteeEditor/)
    assert.match(read('foundation/app/components/DirectoryCommitteesReadPage.vue'), /<DirectoryCommitteeEditor/)
    const viewer = await render()
    assert.match(viewer, /测试委员会/)
    assert.match(viewer, /查看/)
    assert.doesNotMatch(viewer, /新建委员会|>编辑<|>删除</)
    state.edit = true
    const manager = await render()
    assert.match(manager, /新建委员会/)
    assert.match(manager, />编辑</)
    assert.match(manager, />删除</)
    for (const status of [401, 403, 503]) {
      state.error = { statusCode: status }
      const failed = await render()
      assert.match(failed, status === 403 ? /无权限/ : /委员会加载失败/)
      assert.doesNotMatch(failed, /新建委员会|测试委员会/)
    }
  } finally { Object.assign(globalThis, previous) }
})
