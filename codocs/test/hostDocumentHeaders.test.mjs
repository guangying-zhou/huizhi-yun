import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'

const files = [
  'components/company/AssetBrowser.vue', 'components/department/AssetBrowser.vue',
  'components/published/AssetDocument.vue', 'pages/company/open-department-docs.vue',
  'pages/mydocs/shared.vue', 'pages/departments/cabinet.vue'
]
for (const file of files) {
  test(`Host document view ${file} compiles with its shared header`, () => {
    const source = readFileSync(new URL(`../app/${file}`, import.meta.url), 'utf8')
    const { descriptor, errors } = parse(source, { filename: file })
    assert.deepEqual(errors, [])
    const script = compileScript(descriptor, { id: file })
    const template = compileTemplate({ id: file, filename: file, source: descriptor.template.content, compilerOptions: { bindingMetadata: script.bindings } })
    assert.deepEqual(template.errors, [])
    assert.match(source, file.endsWith('shared.vue') ? /<MyDocumentSpaceHeader/ : /<ContentPageHeader/)
    assert.match(source, file.endsWith('shared.vue') ? /import MyDocumentSpaceHeader/ : /import ContentPageHeader/)
  })
}

test('company category routes reuse one header and open departments use the authenticated Directory source', () => {
  for (const page of ['notice', 'rules', 'legal', 'culture', 'tech-specs', 'knowledge', 'templates']) {
    const source = readFileSync(new URL(`../app/pages/company/${page}.vue`, import.meta.url), 'utf8')
    assert.match(source, /<CompanyAssetBrowser[^>]*title=/)
  }
  const open = readFileSync(new URL('../app/pages/company/open-department-docs.vue', import.meta.url), 'utf8')
  assert.match(open, /directoryStore\.fetchDepartments\(\)/)
  assert.match(open, /openDepartmentOptions\(directoryStore\.departmentFlat/)
  assert.match(open, /v-if="loadError"/)
  assert.doesNotMatch(open, /departmentOptions.length > 1/)
})

test('all published PDF channels carry the same viewer watermark as Markdown', () => {
  for (const file of ['company/AssetBrowser.vue', 'department/AssetBrowser.vue', 'published/AssetDocument.vue']) {
    const source = readFileSync(new URL(`../app/components/${file}`, import.meta.url), 'utf8')
    assert.match(source, /useViewerWatermark\(\{ includeTime: true \}\)/)
    assert.match(source, /<PublishedPdfViewer[\s\S]*?:watermark-text="watermarkText"/)
    assert.match(source, /<EditorDocLazyPreview[\s\S]*?:watermark-text="watermarkText"/)
  }
  const file = 'components/published/PdfViewer.client.vue'
  const source = readFileSync(new URL(`../app/${file}`, import.meta.url), 'utf8')
  const { descriptor } = parse(source, { filename: file })
  const script = compileScript(descriptor, { id: file })
  const template = compileTemplate({ id: file, filename: file, source: descriptor.template.content, compilerOptions: { bindingMetadata: script.bindings } })
  assert.deepEqual(template.errors, [])
  assert.match(source, /v-if="watermarkText && !loading && !errorMessage"/)
  assert.match(source, /class="pdf-watermark"/)
  assert.match(source, /pointer-events: none/)
})
