import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { parse, compileTemplate } from '@vue/compiler-sfc'

const pages = [
  'company/rules', 'company/notice', 'company/legal', 'company/culture',
  'company/tech-specs', 'company/knowledge', 'company/templates',
  'company/open-department-docs', 'company/document',
  'company/department-document', 's/[token]'
]

test('Codocs B2 Host pages compile as complete Vue SFC templates', () => {
  for (const page of pages) {
    const filename = fileURLToPath(new URL(`../../codocs/app/pages/${page}.vue`, import.meta.url))
    const { descriptor, errors } = parse(readFileSync(filename, 'utf8'), { filename })
    assert.deepEqual(errors, [], page)
    assert.ok(descriptor.template, page)
    assert.deepEqual(compileTemplate({ source: descriptor.template.content, filename, id: `codocs-b2-${page}` }).errors, [], page)
  }
})

test('B2 navigation references only registered pages and Codocs company:view', async () => {
  const { default: entry } = await import('../../codocs/layer/entry.mjs')
  const paths = new Set(entry.pages.map(page => page.path))
  for (const item of entry.navigation.filter(item => item.id.startsWith('codocs.documents.company.') || item.id === 'codocs.documents.template.company' || item.id === 'codocs.documents.review.open-department-docs')) {
    assert.ok(paths.has(item.to.replace(/^\/codocs/, '')), item.to)
    assert.deepEqual(item.permission, { resource: 'company', action: 'view' })
  }
})

test('hosted B2 components use Codocs module paths while standalone paths remain available', () => {
  const components = [
    'company/AssetBrowser', 'company/AssetAccessRecords', 'company/ImportKnowledgeModal',
    'published/AssetDocument', 'published/AssetLinkButton'
  ]
  for (const component of components) {
    const filename = fileURLToPath(new URL(`../../codocs/app/components/${component}.vue`, import.meta.url))
    const source = readFileSync(filename, 'utf8')
    assert.match(source, /useCodocsModule\(/, component)
    assert.match(source, /moduleUrl\(/, component)
  }
  for (const component of components.slice(1)) {
    const filename = fileURLToPath(new URL(`../../codocs/app/components/${component}.vue`, import.meta.url))
    const source = readFileSync(filename, 'utf8')
    assert.match(source, /hosted\s*\?/, component)
    assert.match(source, /resolveCurrentAppPath\(/, component)
  }
})
