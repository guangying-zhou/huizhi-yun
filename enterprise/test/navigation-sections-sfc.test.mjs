import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { build } from 'esbuild'
import { parse, compileScript } from '@vue/compiler-sfc'
import { createSSRApp, defineComponent, h, ref, computed, reactive, watch, inject, provide } from 'vue'
import { renderToString } from '@vue/server-renderer'

// Compile the real section AND recursive tree templates: a source-string test
// would not catch a missing component import or a template ref-unwrapping bug.
const file = resolve(import.meta.dirname, '../app/components/HostNavSections.vue')
const result = await build({
  entryPoints: [file], bundle: true, platform: 'node', format: 'cjs', write: false, external: ['vue'],
  plugins: [{ name: 'actual-vue-sfc', setup(builder) {
    builder.onLoad({ filter: /\.vue$/ }, ({ path }) => ({
      contents: compileScript(parse(readFileSync(path, 'utf8'), { filename: path }).descriptor, { id: path, inlineTemplate: true }).content,
      loader: 'ts'
    }))
  } }]
})
const module = { exports: {} }
new Function('require', 'module', 'exports', result.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports)

test('real navigation sections keep primary and auxiliary areas as non-collapsible headings and render active descendants', async () => {
  Object.assign(globalThis, {
    ref, computed, reactive, watch, inject, provide,
    useRoute: () => ({ path: '/aims/projects' }),
    useRuntimeConfig: () => ({ public: { platformEnvironment: 'test' } }),
    useState: (_key, init) => ref(init())
  })
  const app = createSSRApp(module.exports.default, {
    primary: [{ id: 'delivery', code: 'delivery', label: '交付与服务', icon: 'i-lucide-box', children: [
      { id: 'delivery.project', label: '项目管理', children: [{ id: 'projects', label: '项目总览', to: '/aims/projects' }, { id: 'tasks', label: '任务中心', to: '/aims/work-items' }] }
    ] }],
    auxiliary: [{ id: 'documents', code: 'documents', label: '文档', icon: 'i-lucide-file', children: [
      { id: 'documents.mine', label: '我的文档', children: [{ id: 'mydocs', label: '全部文档', to: '/codocs/mydocs' }, { id: 'recent', label: '最近使用', to: '/codocs/recent' }] }
    ] }]
  })
  app.component('NuxtLink', defineComponent({ props: ['to'], setup(props, { slots }) {
    return () => h('a', { href: props.to }, slots.default?.())
  } }))
  app.component('UIcon', defineComponent({ setup: () => () => h('span') }))
  app.component('USeparator', defineComponent({ setup: () => () => h('hr') }))
  const html = await renderToString(app)
  assert.match(html, /<p\b[^>]*>交付与服务<\/p>/)
  assert.match(html, /<p\b[^>]*>文档<\/p>/)
  assert.match(html, /<button\b[^>]*aria-expanded="true"[^>]*>[\s\S]*?项目管理[\s\S]*?<\/button>/)
  assert.match(html, /<a\b[^>]*href="\/aims\/projects"[^>]*aria-current="page"[^>]*>[\s\S]*?项目总览/)
  assert.match(html, /<button\b[^>]*aria-expanded="false"[^>]*>[\s\S]*?我的文档[\s\S]*?<\/button>/)
  assert.doesNotMatch(html, /href="\/codocs\/mydocs"/)
  for (const button of html.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)) assert.doesNotMatch(button[1], /交付与服务|>文档</)
})

test('workspace leaves are direct links without heading, submenu arrows or notifications', async () => {
  const { buildBusinessNavigation, navigationContributors } = await import('../composition/registry.mjs')
  const { businessAreas, auxiliaryAreas } = await import('../composition/business-areas.mjs')
  const { filterNavigationAccess } = await import('../shared/navigation-access.mjs')
  const nav = buildBusinessNavigation(navigationContributors, businessAreas, auxiliaryAreas)
  const visible = filterNavigationAccess(nav, ['console.workspace.home', 'console.workspace.todos', 'codocs.workspace.self.journal'])
  globalThis.useRoute = () => ({ path: '/enterprise/todos' })
  const app = createSSRApp(module.exports.default, visible)
  app.component('NuxtLink', defineComponent({ props: ['to'], setup(props, { slots }) {
    return () => h('a', { href: props.to }, slots.default?.())
  } }))
  app.component('UIcon', defineComponent({ props: ['name'], setup: props => () => h('span', { 'data-icon': props.name }) }))
  const html = await renderToString(app)
  for (const [path, label] of [['/enterprise', '工作台'], ['/enterprise/todos', '我的待办'], ['/codocs/mydocs/journal', '工作汇报']]) assert.match(html, new RegExp(`<a[^>]*href="${path}"[^>]*>[\\s\\S]*?${label}`))
  assert.match(html, /href="\/enterprise\/todos"[^>]*aria-current="page"/)
  assert.doesNotMatch(html, /<p|<button|chevron|我的工作|通知/)
  const revoked = filterNavigationAccess(nav, ['console.workspace.home', 'console.workspace.todos'])
  assert.ok(!JSON.stringify(revoked).includes('工作汇报'))
  const layout = readFileSync(new URL('../app/layouts/default.vue', import.meta.url), 'utf8')
  assert.match(layout, /filter\(area => area.heading === false\)/)
  assert.match(layout, /:to="group.children\[0\]\?\.to"/)
  assert.match(layout, /v-model:open="drawer"/)
})
