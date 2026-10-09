import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { parse, compileScript } from '@vue/compiler-sfc'

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')
test('Host inset ownership is structural, with no route list and an explicit editor exclusion', () => {
  const layout = read('../app/layouts/default.vue')
  const { descriptor, errors } = parse(layout)
  assert.deepEqual(errors, [])
  assert.ok(compileScript(descriptor, { id: 'host-layout', inlineTemplate: true }).content)
  assert.match(layout, /:data-content-width="route.meta.hostContentWidth"/)
  assert.match(layout, /class="host-page-container"/)
  assert.match(layout, /:data-editor-workspace="editorWorkspace \|\| undefined"/)
  assert.match(layout, /route\.value\.meta\.hostContentInset === false/)
  const legacy = read('../../aims/layer/pages/enterprise-legacy-page.vue')
  assert.match(legacy, /import ContentPageHeader from/)
  assert.match(legacy, /<ContentPageHeader :hosted="true"/)
  assert.doesNotMatch(legacy, /max-w-3xl|mx-auto|sm:p-6/)
  const legacyDescriptor = parse(legacy).descriptor
  assert.ok(compileScript(legacyDescriptor, { id: 'legacy-entry', inlineTemplate: true }).content)
  const css = read('../app/assets/css/main.css').split('/* A page owns its inset')[1]
  assert.ok(css)
  assert.match(css, /:not\(\[data-editor-workspace\]\)/)
  assert.match(css, /> \[data-slot="root"\] > \[data-slot="body"\]/)
  assert.match(css, /:has\(> \.p-4:only-child\)/)
  assert.match(css, /min-width: 640px/)
  assert.doesNotMatch(css, /!important|\/(?:altoc|people|finance|assets)\//)
  // Reference and composition/standalone components keep their original inset.
  assert.match(read('../app/components/AltocContractsPage.vue'), /px-4 pt-4 sm:px-6 sm:pt-6/)
  assert.match(read('../../assets/app/components/assets/ProductAssetsListPage.vue'), /space-y-4 p-4 sm:p-6/)
})

test('read-only product workspaces declare full width; creation forms retain their limit', () => {
  for (const page of ['adoption', 'execution-coordination', 'feature-version-matrix', 'release-comparison', 'objectives/index', 'views/index', 'cycles/[cycleId]/capacity', 'cycles/[cycleId]/matrix', 'cycles/[cycleId]/roadmap', 'versions/[versionId]/plan', 'versions/[versionId]/acceptances/index', 'features/[featureId]/roadmap', 'features/[featureId]/requests']) {
    const source = read(`../../aims/app/pages/products/[productCode]/${page}.vue`)
    assert.match(source, /hostContentWidth: 'full'/)
    const { descriptor, errors } = parse(source)
    assert.deepEqual(errors, [])
    assert.ok(compileScript(descriptor, { id: page, inlineTemplate: true }).content)
  }
  const form = read('../../aims/app/pages/products/[productCode]/objectives/new.vue')
  assert.doesNotMatch(form, /hostContentWidth: 'full'/)
  assert.match(form, /max-w-4xl/)
})

test('Codocs default-slot panels own their inset without requiring a body slot', async () => {
  const { default: codocs } = await import('../../codocs/layer/entry.mjs')
  const css = read('../app/assets/css/main.css')
  assert.match(read('../app/layouts/default.vue'), /:data-page-app="route.meta.authorizationApp"/)
  assert.match(css, /\[data-page-app="codocs"\]:not\(\[data-editor-workspace\]\):has\(> \[data-slot="root"\]\)/)
  assert.match(css, /> header:has\(\[data-host-page-title\]\)/)
  // Cover the actual composed roots, not just a hand-picked set of APF pages.
  for (const page of codocs.pages.filter(page => !['document-editor', 'company-document', 'department-document', 'published-asset-short-link'].includes(page.name))) {
    const source = readFileSync(page.file, 'utf8')
    assert.match(source, /<UDashboardPanel|<(?:Company|Department)AssetBrowser/, page.path)
    assert.doesNotMatch(source, /<div[^>]*class="[^"]*(?:max-w-7xl|container mx-auto)/, page.path)
  }
})
