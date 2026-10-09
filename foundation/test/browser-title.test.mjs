import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const nuxtRequire = createRequire(require.resolve('nuxt/package.json'))
const { createHead } = await import(nuxtRequire.resolve('@unhead/vue/server'))
const ts = require('typescript')

const source = readFileSync(new URL('../app/plugins/browser-title.ts', import.meta.url), 'utf8')

test('Foundation title template formats initial, reactive and navigated module page names', async () => {
  const head = createHead()
  let plugin
  new Function('defineNuxtPlugin', 'useHead', 'useRoute', ts.transpileModule(source.replace('export default ', ''), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText)(
    (value) => { plugin = value }, (input, options) => head.push(typeof input === 'function' ? input() : input, options), () => ({ meta: {} })
  )
  assert.deepEqual(plugin.dependsOn, ['nuxt:head'])
  plugin.setup()
  for (const name of ['Aims 项目', 'Codocs 文档', 'Finance 账户', 'People 岗位', 'Console 通知', 'Workflow 待办', 'Altoc 合同']) {
    const entry = head.push({ title: name, titleTemplate: '%s - 业务模块' })
    let titles = (await head.resolveTags()).filter(tag => tag.tag === 'title')
    assert.deepEqual(titles.map(tag => tag.textContent), [`${name} - 汇智云`])
    entry.patch({ title: `${name}详情`, titleTemplate: () => '页面自设标题' })
    titles = (await head.resolveTags()).filter(tag => tag.tag === 'title')
    assert.deepEqual(titles.map(tag => tag.textContent), [`${name}详情 - 汇智云`])
    entry.dispose()
  }
  const blank = head.push({ title: '   ' })
  assert.deepEqual((await head.resolveTags()).filter(tag => tag.tag === 'title').map(tag => tag.textContent), ['汇智云'])
  blank.dispose()
  assert.deepEqual((await head.resolveTags()).filter(tag => tag.tag === 'title').map(tag => tag.textContent), ['汇智云'])
})

test('page headers and shared titles provide names without duplicating the browser brand', () => {
  const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')
  assert.match(read('../app/components/ContentPageHeader.vue'), /props.hosted \? \{ title: props.title \} : \{\}/)
  assert.match(read('../app/composables/usePageTitle.ts'), /useHead\(\(\) => \(\{ title: isRef\(title\)/)
  assert.match(source, /route.meta.layoutHeaderTitle/)
  assert.match(read('../../workflow/app/composables/usePageTitle.ts'), /export \{ usePageTitle \} from.*foundation/)
  assert.match(read('../../workflow/app/pages/index.vue'), /usePageTitle\('流程工作台'\)/)
  for (const path of ['../../enterprise/app/error.vue', '../../console/app/error.vue', '../../console/app/pages/login.vue', '../../console/app/pages/set-password.vue', '../../console/app/pages/shell/[appCode].vue']) {
    assert.doesNotMatch(read(path), /title:.*汇智云/)
  }
})
