import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import { parse, compileScript } from '@vue/compiler-sfc'
import { createSSRApp, defineComponent, h } from 'vue'
import { renderToString } from '@vue/server-renderer'

async function header() {
  const path = new URL('../app/components/ContentPageHeader.vue', import.meta.url).pathname
  const result = await build({ entryPoints: [path], bundle: true, platform: 'node', format: 'cjs', write: false, external: ['vue'], plugins: [{ name: 'sfc', setup(builder) {
    builder.onLoad({ filter: /\.vue$/ }, ({ path }) => {
      const { descriptor, errors } = parse(readFileSync(path, 'utf8'), { filename: path })
      assert.deepEqual(errors, [])
      return { contents: compileScript(descriptor, { id: path, inlineTemplate: true }).content, loader: 'ts' }
    })
  } }] })
  const module = { exports: {} }
  new Function('require', 'module', 'exports', 'useHead', result.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports, () => {})
  return module.exports.default
}
test('Host header removes breadcrumb but retains title, tooltip description and return action', async () => {
  const component = await header()
  const app = createSSRApp({ render: () => h(component, { hosted: true, title: '客户详情', breadcrumb: '禁止显示的导航路径', description: '完整说明' }, { actions: () => h('a', { href: '/altoc/customers' }, '返回列表') }) })
  app.component('UTooltip', defineComponent({ props: ['text'], setup: (props, { slots }) => () => h('div', { 'data-tooltip': props.text }, slots.default?.()) }))
  const html = await renderToString(app)
  assert.match(html, /<h1[^>]*data-host-page-title[^>]*>客户详情<\/h1>/)
  assert.doesNotMatch(html, /禁止显示的导航路径/)
  assert.match(html, /data-tooltip="完整说明"/)
  assert.match(html, /truncate text-sm text-muted/)
  assert.match(html, /basis-full sm:flex-1 sm:basis-0/)
  assert.match(html, /href="\/altoc\/customers">返回列表/)
  assert.doesNotMatch(html, /line-clamp|mt-1/)
  assert.match(readFileSync(new URL('../app/components/ContentPageHeader.vue', import.meta.url), 'utf8'), /max-w-\[calc\(100vw-2rem\)\] sm:max-w-lg/)
  assert.match(readFileSync(new URL('../app/components/ContentPageHeader.vue', import.meta.url), 'utf8'), /whitespace-normal break-words/)
  assert.match(readFileSync(new URL('../app/components/ContentPageHeader.vue', import.meta.url), 'utf8'), /content: 'h-auto/)
})
test('standalone stays hidden and headers without descriptions have no empty tooltip', async () => {
  const component = await header()
  assert.doesNotMatch(await renderToString(createSSRApp(component, { hosted: false, title: '独立端已有标题', description: '说明' })), /独立端已有标题|说明/)
  const html = await renderToString(createSSRApp(component, { hosted: true, title: '我的文档' }))
  assert.match(html, /我的文档/)
  assert.doesNotMatch(html, /tabindex|title=/)
})
