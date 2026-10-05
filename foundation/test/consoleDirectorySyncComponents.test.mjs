import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import { createSSRApp, defineComponent, h, computed } from 'vue'
import { renderToString } from '@vue/server-renderer'

const root = new URL('../../', import.meta.url)
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

function appFor(component, props) {
  const app = createSSRApp(component, props)
  const box = defineComponent({ setup: (_, { slots }) => () => h('div', [slots.header?.(), slots.body?.(), slots.actions?.(), slots.default?.(), slots.footer?.()]) })
  for (const name of ['UDashboardPanel', 'UCard', 'USkeleton', 'ContentPageHeader']) app.component(name, box)
  app.component('UButton', defineComponent({ props: ['to', 'label'], setup: (props, { slots }) => () => h('a', { href: props.to }, [props.label, slots.default?.()]) }))
  app.component('UBadge', box)
  for (const name of ['CommonEmptyState', 'UAlert']) app.component(name, defineComponent({ props: ['title', 'description'], setup: props => () => h('p', [props.title, props.description]) }))
  app.component('UTable', defineComponent({ props: ['data', 'columns'], setup: (props, { slots }) => () => props.data.length ? h('table', props.data.map(original => h('tr', props.columns.map(column => h('td', column.cell ? column.cell({ row: { original } }) : original[column.accessorKey]))))) : slots.empty?.() }))
  return app
}
const job = { jobCode: 'J1', providerCode: 'ldap', syncType: 'full', objectScope: 'all', status: 'failed', totalCount: 12, errorCount: 1, errorMessage: 'SECRET-DIAGNOSTIC', requestedBy: 'SECRET-REQUESTER', failureCategory: 'Platform同步失败' }
const event = { id: 1, jobCode: 'J1', objectType: 'user', objectCode: 'U1', status: 'failed', sourceProvider: 'ldap', changeType: 'error', externalRef: 'SECRET-EXTERNAL', message: 'SECRET-EVENT', failureCategory: '连接器同步失败' }

test('sync shared presentation preserves Console diagnostics and renders only fixed categories in Host mode', async () => {
  const previous = { computed: globalThis.computed }
  globalThis.computed = computed
  try {
    const list = await page('foundation/app/components/DirectorySyncJobsTable.vue')
    const detail = await page('foundation/app/components/DirectorySyncJobDetails.vue')
    const plain = await renderToString(appFor(detail, { job, events: [event] }))
    for (const text of ['SECRET-DIAGNOSTIC', 'SECRET-REQUESTER', 'SECRET-EXTERNAL', 'SECRET-EVENT']) assert.ok(plain.includes(text))
    const safe = await renderToString(appFor(detail, { job, events: [event], redacted: true }))
    assert.match(safe, /Platform同步失败/)
    assert.match(safe, /连接器同步失败/)
    assert.match(safe, /U1/)
    assert.doesNotMatch(safe, /SECRET/)
    const safeList = await renderToString(appFor(list, { jobs: [job], redacted: true, detailPath: '/enterprise/directory/sync' }))
    assert.match(safeList, /href="\/enterprise\/directory\/sync\/J1"/)
    assert.match(safeList, /Platform同步失败/)
    assert.doesNotMatch(safeList, /SECRET/)
    assert.match(await renderToString(appFor(list, { jobs: [] })), /暂无同步任务/)
  } finally { Object.assign(globalThis, previous) }
})
