import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import { createSSRApp, defineComponent, h, ref, computed, watch, onMounted, onScopeDispose } from 'vue'
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

test('Host sync controller hides stale jobs/events on 401/403/503 and provides Console links', async () => {
  const state = { status: 0, eventStatus: 0, detail: false, eventsCalls: 0 }
  const mocks = { ref, computed, watch: () => {}, onScopeDispose, usePageTitle: () => {},
    useRoute: () => ({ path: '/enterprise/directory/sync', fullPath: '/enterprise/directory/sync?page=1', query: {page:'1'} }),
    useRouter: () => ({ push: async () => {} }), useAuth: () => ({user:ref('alice')}), useState: () => ref('alice-policy-1'),
    $fetch: async (url) => {
      const events = url.endsWith('/events')
      if (events) state.eventsCalls++
      const status = events ? state.eventStatus : state.status
      if (status) throw Object.assign(Error('SECRET-UPSTREAM'), {statusCode:status})
      return {code:0,data:events ? {items:[event],total:21,page:1,pageSize:20} : state.detail ? job : {items:[job],total:21,page:1,pageSize:20}}
    }
  }
  const previous = Object.fromEntries(Object.keys(mocks).map(key => [key, globalThis[key]]))
  Object.assign(globalThis, mocks)
  try {
    const component = await page('foundation/app/components/DirectorySyncReadPage.vue')
    const list = await page('foundation/app/components/DirectorySyncJobsTable.vue')
    const detail = await page('foundation/app/components/DirectorySyncJobDetails.vue')
    const render = async () => {
      const app = appFor(component, { apiPath: '/enterprise/api/directory/sync-jobs', pagePath: '/enterprise/directory/sync', consolePath: '/console/directory/sync', jobCode: state.detail ? 'J1' : undefined })
      app.component('DirectorySyncJobsTable', list).component('DirectorySyncJobDetails', detail)
      return renderToString(app)
    }
    const listHtml = await render()
    assert.match(listHtml, /Platform同步失败/)
    assert.match(listHtml, /共 21 条任务/)
    assert.match(listHtml, /returnTo=/)
    assert.equal(state.eventsCalls, 0)
    state.detail = true
    const html = await render()
    assert.match(html, /href="\/console\/directory\/sync\/J1"/)
    assert.match(html, /连接器同步失败/)
    assert.match(html, /共 21 条事件/)
    for (const status of [401, 403, 503]) {
      for (const target of ['status', 'eventStatus']) {
        state.status = state.eventStatus = 0
        state[target] = status
        const failed = await render()
        assert.match(failed, status === 403 ? /无权限/ : /同步记录加载失败/)
        assert.doesNotMatch(failed, /Platform同步失败|连接器同步失败|SECRET|U1/)
      }
    }
  } finally { Object.assign(globalThis, previous) }
})
