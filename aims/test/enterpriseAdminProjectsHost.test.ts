import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const source = read('../layer/pages/enterprise-admin-projects.vue')
const editor = read('../app/components/project/EnterpriseAdminProjectEditor.vue')
const entry = read('../layer/entry.mjs')
for (const path of ['../layer/pages/enterprise-admin-projects.vue', '../layer/pages/enterprise-admin-project-edit.vue', '../layer/pages/enterprise-project-new.vue', '../layer/pages/enterprise-portfolio-new.vue', '../app/components/project/EnterpriseAdminProjectEditor.vue', '../app/components/project/ProjectPortfolioSelect.vue']) {
  test(`Host project management complete SFC compiles: ${path}`, () => {
    const filename = new URL(path, import.meta.url).pathname
    const { descriptor, errors } = parse(read(path), { filename })
    assert.deepEqual(errors, [])
    const script = compileScript(descriptor, { id: path })
    const template = compileTemplate({ filename, id: path, source: descriptor.template!.content, compilerOptions: { bindingMetadata: script.bindings } })
    assert.deepEqual(template.errors, [])
  })
}
test('administrator list uses server paging and separate native command routes without destructive shortcuts', () => {
  assert.match(entry, /layerPage\('\/admin\/projects', 'admin-projects', 'enterprise-admin-projects'\)/)
  assert.match(entry, /to: '\/aims\/admin\/projects', permission: \{ resource: 'admin', action: 'admin' \}/)
  assert.match(source, /page: page\.value, pageSize: pageSize\.value/)
  assert.match(source, /<UTable[\s\S]*?:loading="children\[root.id\]!.loading"/)
  assert.match(source, /<template #empty>[\s\S]*?<CommonEmptyState/)
  assert.match(source, /<UPagination[\s\S]*?:total="total"/)
  assert.match(source, /useDebouncedSearch/)
  assert.doesNotMatch(source, /method: 'DELETE'|window\.confirm|lifecycleStatus:.*body/)
  assert.match(source, /projects\/\$\{.*?\}\/settings/)
})
test('administrator edit retains draft and only submits changed fields with current version and stable intent', () => {
  assert.match(editor, /projectAccessControlPatch\(original\.value, draft\.value\)/)
  assert.match(editor, /if \(draft\.value\[field\] !== original\.value\[field\]\)/)
  assert.match(editor, /expectedVersion: editing\.value\.editVersion, \.\.\.changed/)
  assert.match(editor, /'Idempotency-Key': operation\.key/)
  assert.match(editor, /tone: 'warning'/)
  assert.match(editor, /editFeedback\.value = 'conflict'/)
  assert.match(editor, /projectId: String\(editing\.value\.id\)/)
  assert.match(editor, /<ProjectAccessControlFields/)
})
test('batch intent freezes year and closes its dialog before confirmation; remote portfolio paging stays in popup', () => {
  assert.match(source, /batchOpen\.value = false[\s\S]*?await confirm/)
  assert.match(source, /year: intent\.year/)
  assert.match(source, /'Idempotency-Key': intent\.key/)
  const selector = read('../app/components/project/ProjectPortfolioSelect.vue')
  assert.match(selector, /<RemoteObjectSelectMenu/)
  assert.doesNotMatch(selector, /<UPagination|共.*条/)
  assert.match(selector, /current !== generation/)
})

test('project tree keeps accessible expansion and permission-gated portfolio actions, prefilling only a valid id', () => {
  assert.match(source, /:aria-expanded="expanded.has\(root.id\)"/)
  assert.match(source, /root.id && canCreatePortfolio/)
  assert.match(source, /v-if="canCreate"[\s\S]*?portfolioId/)
  assert.match(source, /共 \{\{ total \}\} 个项目集 \/ 分组/)
  const create = read('../layer/pages/enterprise-project-new.vue')
  assert.match(create, /route.query.portfolioId/)
})

test('Host product space and project overview have exactly one contract-sized outer inset', () => {
  const products = read('../app/pages/products/index.vue')
  const projects = read('../app/pages/projects/index.vue')
  const overview = read('../layer/pages/enterprise-project-detail.vue')
  for (const source of [products, projects, overview]) {
    assert.match(source, /hostContentInset: false/)
    assert.doesNotMatch(source, /padding:\s*3rem|p-8|max-w-7xl/)
  }
  assert.match(products, /overflow-y-auto p-4 sm:p-6/)
  assert.match(overview, /overflow-y-auto p-4 sm:p-6/)
})
