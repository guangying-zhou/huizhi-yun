import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { parse, compileScript } from '@vue/compiler-sfc'
import { createSSRApp, createRenderer, defineComponent, h, ref, computed, nextTick, onMounted, onUnmounted } from 'vue'
import { renderToString } from '@vue/server-renderer'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { enterprisePageKey } from '../app/utils/enterprise-page-key.mjs'

const repoRoot = resolve(import.meta.dirname, '../..')
const pageFile = resolve(repoRoot, 'aims/layer/pages/enterprise-project-detail.vue')
const descriptor = parse(readFileSync(pageFile, 'utf8'), { filename: pageFile }).descriptor
const script = compileScript(descriptor, { id: 'enterprise-project-detail', inlineTemplate: true }).content
const virtualModule = '\0hzy-aims-module'
const output = (await build({
  stdin: { contents: script, sourcefile: pageFile, resolveDir: resolve(repoRoot, 'aims/layer/pages'), loader: 'ts' }, bundle: true, format: 'cjs', platform: 'node', write: false,
  plugins: [{ name: 'aims-module-stub', setup(build) {
    build.onResolve({ filter: /\.\.\/useAimsModule$/ }, () => ({ path: virtualModule, namespace: 'hzy-test' }))
    build.onLoad({ filter: /.*/, namespace: 'hzy-test' }, () => ({ contents: 'export const useAimsModule = () => ({ moduleUrl: path => `/aims${path}` })', loader: 'js' }))
  } }],
  external: ['vue']
})).outputFiles[0].text
const module = { exports: {} }
new Function('require', 'module', 'exports', output)(createRequire(import.meta.url), module, module.exports)
const DetailPage = module.exports.default
const sidebarFile = resolve(repoRoot, 'enterprise/app/components/HostObjectNav.vue')
const sidebarScript = compileScript(parse(readFileSync(sidebarFile, 'utf8'), { filename: sidebarFile }).descriptor, { id: 'host-object-nav', inlineTemplate: true }).content
const sidebarOutput = (await build({ stdin: { contents: sidebarScript, sourcefile: sidebarFile, loader: 'ts' }, bundle: true, format: 'cjs', platform: 'node', write: false, external: ['vue'] })).outputFiles[0].text
const sidebarModule = { exports: {} }
new Function('require', 'module', 'exports', sidebarOutput)(createRequire(import.meta.url), sidebarModule, sidebarModule.exports)

const route = { path: '/aims/projects/42', params: { id: '42' } }
const Link = defineComponent({ name: 'TestLink', props: { to: { type: [String, Object], default: '' } }, setup(props, { slots }) {
  const href = typeof props.to === 'string' ? props.to : `${props.to.path}${props.to.query ? `?${new URLSearchParams(props.to.query).toString()}` : ''}${props.to.hash || ''}`
  return () => h('a', { href }, slots.default?.())
} })
const Stub = defineComponent({
  setup(_, { slots }) {
    return () => h('div', slots.default?.())
  }
})
const Badge = defineComponent({
  props: { color: { type: String, default: '' } },
  setup(props, { slots }) {
    return () => h('span', { 'data-color': props.color }, slots.default?.())
  }
})

async function renderDetail(backTo, visibleIds = [], projectData = {}, directory = []) {
  const model = ref({ objectPath: '/aims/projects/42', label: '验收项目', projects: [], projectsSearch: '', projectsPage: 1, projectsPageSize: 20, projectsTotal: 0, backTo, backLabel: backTo.startsWith('/assets') ? '返回产品上下文' : '返回项目总览', groups: [{ id: 'manage', label: '管理', items: [{ id: 'edit', label: '编辑', path: '/edit' }] }] })
  const context = { model, project: ref({ id: 42, name: '验收项目', projectCode: 'P-42', ...projectData }), loading: ref(false), error: ref(''), canCreateWorkItem: ref(false), refresh: async () => {} }
  globalThis.useProvidedEnterpriseProjectObjectContext = () => context
  globalThis.useRoute = () => route
  globalThis.computed = computed
  globalThis.ref = ref
  globalThis.useAimsModule = () => ({ moduleUrl: path => `/aims${path}` })
  globalThis.useAccountDepartments = () => ({ flat: ref(directory) })
  globalThis.useEnterpriseNavigationAccess = () => ({ workspaces: ref([{ code: 'aims-project', groups: [{ items: visibleIds.map(id => ({ id })) }] }]) })
  const app = createSSRApp(DetailPage)
  for (const name of ['UButton', 'NuxtLink']) app.component(name, Link)
  for (const name of ['UAlert', 'USkeleton', 'UCard', 'UIcon']) app.component(name, Stub)
  app.component('EnterpriseProjectProducts', Stub)
  app.component('UBadge', Badge)
  const sidebar = createSSRApp(sidebarModule.exports.default, { model: model.value })
  for (const name of ['UButton', 'NuxtLink']) sidebar.component(name, Link)
  for (const name of ['UFormField', 'UInput', 'UDropdownMenu', 'UPagination', 'USeparator', 'UIcon']) sidebar.component(name, Stub)
  return { detail: await renderToString(app), sidebar: await renderToString(sidebar) }
}

test('real detail SFC renders the model return href for product and filtered project sources', async () => {
  const productHtml = await renderDetail('/assets/products/42?tab=planning#versions')
  for (const html of Object.values(productHtml)) {
    assert.match(html, /href="\/assets\/products\/42\?tab=planning#versions"/)
    assert.match(html, /返回产品上下文/)
  }
  const listHtml = await renderDetail('/aims/projects?page=3&search=Alpha#row')
  for (const html of Object.values(listHtml)) {
    assert.match(html, /href="\/aims\/projects\?page=3&amp;search=Alpha#row"/)
    assert.match(html, /返回项目总览/)
  }
})

test('project overview uses shared Chinese status/category badges and directory department name', async () => {
  const known = (await renderDetail('/aims/projects', [], {
    lifecycleStatus: 'active', category: 'product_dev', deptCode: 'SDC'
  }, [{ deptCode: 'SDC', name: '软件开发中心' }])).detail
  assert.match(known, /data-color="success"[^>]*>进行中<\/span>/)
  assert.match(known, /data-color="info"[^>]*>产品开发<\/span>/)
  assert.match(known, /所属部门[\s\S]*软件开发中心/)
  assert.doesNotMatch(known, />active<|>product_dev<|>SDC</)

  const fallback = (await renderDetail('/aims/projects', [], {
    lifecycle_status: 'legacy_state', category: 'legacy_kind', dept_code: 'UNKNOWN'
  })).detail
  assert.match(fallback, /data-color="neutral"[^>]*>legacy_state<\/span>/)
  assert.match(fallback, /data-color="neutral"[^>]*>legacy_kind<\/span>/)
  assert.match(fallback, /所属部门[\s\S]*UNKNOWN/)
})

test('project overview actions follow the layout navigation lease', async () => {
  const none = (await renderDetail('/aims/projects')).detail
  assert.doesNotMatch(none, /查看项目工时|查看项目周报/)
  const timesheet = (await renderDetail('/aims/projects', ['aims.project.timesheet'])).detail
  assert.match(timesheet, /查看项目工时/)
  assert.doesNotMatch(timesheet, /查看项目周报/)
  const weekly = (await renderDetail('/aims/projects', ['aims.project.weekly-reports'])).detail
  assert.doesNotMatch(weekly, /查看项目工时/)
  assert.match(weekly, /查看项目周报/)
})

test('Host page identity preserves scope and path while query/hash changes stay in one page instance key', async () => {
  const a = enterprisePageKey('session-1', { path: '/aims/projects', fullPath: '/aims/projects?search=A#one' })
  const b = enterprisePageKey('session-1', { path: '/aims/projects', fullPath: '/aims/projects?search=B#two' })
  const c = enterprisePageKey('session-2', { path: '/aims/projects', fullPath: '/aims/projects?search=B#two' })
  assert.equal(a, b)
  assert.notEqual(a, c)
  assert.notEqual(enterprisePageKey('session-1', { path: '/codocs/mydocs/journal', query: { mode: 'worklog' } }), enterprisePageKey('session-1', { path: '/codocs/mydocs/journal', query: { mode: 'weekly' } }))
  assert.notEqual(enterprisePageKey('session-1', { path: '/aims/projects/42/requirements', query: { tab: 'list' } }), enterprisePageKey('session-1', { path: '/aims/projects/42/requirements', query: { tab: 'review' } }))
  assert.match(readFileSync(resolve(repoRoot, 'enterprise/app/app.vue'), 'utf8'), /enterprisePageKey/)

  let mounted = 0
  let unmounted = 0
  const Child = defineComponent({
    setup: () => {
      onMounted(() => mounted++)
      onUnmounted(() => unmounted++)
      return () => h('span', 'page')
    }
  })
  const route = ref({ path: '/aims/projects', query: { search: 'A' } })
  const session = ref('session-1')
  const Root = defineComponent({ setup: () => () => h(Child, { key: enterprisePageKey(session.value, route.value) }) })
  const renderer = createRenderer({
    patchProp: () => {}, insert: () => {}, remove: () => {}, createElement: type => ({ type }), createText: text => ({ text }), createComment: text => ({ text }), setText: (node, text) => {
      node.text = text
    },
    setElementText: (node, text) => {
      node.text = text
    }, parentNode: () => null, nextSibling: () => null
  })
  const app = renderer.createApp(Root)
  app.mount({ type: 'root', children: [] })
  await nextTick()
  assert.equal(mounted, 1)
  route.value = { path: '/aims/projects', query: { search: 'B' } }
  await nextTick()
  assert.equal(mounted, 1)
  assert.equal(unmounted, 0)
  route.value = { path: '/codocs/mydocs/journal', query: { mode: 'weekly' } }
  await nextTick()
  assert.equal(mounted, 2)
  assert.equal(unmounted, 1)
  session.value = 'session-2'
  await nextTick()
  assert.equal(mounted, 3)
  assert.equal(unmounted, 2)
  route.value = { path: '/aims/projects/42', query: {} }
  await nextTick()
  route.value = { path: '/aims/projects/43', query: {} }
  await nextTick()
  assert.equal(mounted, 5)
  assert.equal(unmounted, 4)
  app.unmount()
})
