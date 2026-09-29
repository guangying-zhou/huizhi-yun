import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'

const filename = new URL('../layer/pages/enterprise-admin-projects.vue', import.meta.url).pathname
const source = readFileSync(filename, 'utf8')
const entry = readFileSync(new URL('../layer/entry.mjs', import.meta.url), 'utf8')

test('Host administrator projects page compiles as a complete SFC and uses the separate static-admin route', () => {
  const { descriptor, errors } = parse(source, { filename })
  assert.deepEqual(errors, [])
  const script = compileScript(descriptor, { id: 'enterprise-admin-projects' })
  const template = compileTemplate({ filename, id: 'enterprise-admin-projects', source: descriptor.template!.content, compilerOptions: { bindingMetadata: script.bindings } })
  assert.deepEqual(template.errors, [])
  assert.match(entry, /layerPage\('\/admin\/projects', 'admin-projects', 'enterprise-admin-projects'\)/)
  assert.match(entry, /to: '\/aims\/admin\/projects', permission: \{ resource: 'admin', action: 'admin' \}/)
})

test('administrator list uses server paging, loading and empty state without write shortcuts', () => {
  assert.match(source, /moduleUrl\('\/api\/v1\/admin\/projects'\)/)
  assert.match(source, /page: page\.value, pageSize, search: debounced\.value/)
  assert.match(source, /<UTable[\s\S]*?:loading="loading"/)
  assert.match(source, /<template #empty>[\s\S]*?<CommonEmptyState/)
  assert.match(source, /<UPagination[\s\S]*?:total="total"/)
  assert.match(source, /class="hidden w-full md:block"/)
  assert.match(source, /class="grid gap-3 md:hidden"/)
  assert.doesNotMatch(source, /method: '(?:POST|DELETE)'/)
})

test('administrator edit writes only changed fields through its own command and confirms visibility changes', () => {
  assert.match(source, /projectAccessControlPatch\(original\.value, draft\.value\)/)
  assert.match(source, /if \(draft\.value\[field\] !== original\.value\[field\]\)/)
  assert.match(source, /expectedVersion: editing\.value\.editVersion, \.\.\.changed/)
  assert.match(source, /moduleUrl\(`\/api\/v1\/admin\/projects\/\$\{editing\.value\.id\}`\)/)
  assert.match(source, /'Idempotency-Key': operation\.key/)
  assert.match(source, /tone: 'warning'/)
  assert.match(source, /pendingWrite\.value = null[\s\S]*?editFeedback\.value = 'conflict'/)
  assert.match(source, /<ProjectAccessControlFields/)
})
