import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import { activeMyDocumentSpaceTab, myDocumentSpaceTabs } from '../app/utils/myDocumentSpaceTabs'

test('document tabs select exact standalone and hosted deep links without swallowing other pages', () => {
  assert.deepEqual(myDocumentSpaceTabs.map(tab => tab.label), ['我的文档', '最近使用', '与我协同', '收藏', '回收站'])
  for (const tab of myDocumentSpaceTabs) {
    for (const prefix of ['', '/codocs']) {
      assert.equal(activeMyDocumentSpaceTab(`${prefix}${tab.path}`), tab.path)
      assert.equal(activeMyDocumentSpaceTab(`${prefix}${tab.path}/?page=2#list`), tab.path)
    }
  }
  for (const path of ['/codocs/cabinet', '/codocs/documents/abc', '/mydocs/shared/other']) {
    assert.equal(activeMyDocumentSpaceTab(path), null)
  }
})

test('all five pages use the shared route header and compile complete SFCs', () => {
  const files = ['components/MyDocumentSpaceHeader.vue', ...['index', 'recently', 'shared', 'favorites', 'recycle'].map(page => `pages/mydocs/${page}.vue`)]
  for (const file of files) {
    const source = readFileSync(new URL(`../app/${file}`, import.meta.url), 'utf8')
    const { descriptor, errors } = parse(source, { filename: file })
    assert.deepEqual(errors, [], file)
    const script = compileScript(descriptor, { id: file })
    const template = compileTemplate({ source: descriptor.template!.content, filename: file, id: file, compilerOptions: { bindingMetadata: script.bindings } })
    assert.deepEqual(template.errors, [], file)
    if (file.startsWith('pages/')) assert.match(source, /<MyDocumentSpaceHeader\s/)
  }
})

test('tabs use accessible router links, preserve module prefixes and scroll in one row without count requests', () => {
  const source = readFileSync(new URL('../app/components/MyDocumentSpaceHeader.vue', import.meta.url), 'utf8')
  assert.match(source, /<NuxtLink/)
  assert.match(source, /:to="moduleUrl\(tab.path\)"/)
  assert.match(source, /:aria-current="active === tab.path \? 'page' : undefined"/)
  assert.match(source, /flex-nowrap[^"\n]*overflow-x-auto/)
  assert.match(source, /shrink-0 whitespace-nowrap/)
  assert.match(source, /<ContentPageHeader\s+:hosted="hosted"/)
  assert.doesNotMatch(source, /\$fetch|useFetch|useAsyncData|onMounted/)
})
