import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse, compileScript } from '@vue/compiler-sfc'
import { createRequire } from 'node:module'

const ts = createRequire(import.meta.url)('typescript')
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')
test('Altoc toolbars compile, debounce search without a separate search button and keep table pagination', () => {
  for (const name of ['AltocCustomersPage', 'AltocCustomerContacts', 'AltocQuotationsPage', 'AltocListColumns']) {
    const source = read(`../app/components/${name}.vue`)
    const { descriptor, errors } = parse(source, { filename: name })
    assert.deepEqual(errors, [])
    assert.ok(compileScript(descriptor, { id: name, inlineTemplate: true }).content)
    if (name === 'AltocListColumns') continue
    assert.match(source, /useDebouncedSearch/)
    assert.match(source, /@keyup.enter="flush"/)
    assert.doesNotMatch(source, /@click="flush"/)
    assert.match(source, /UPagination/)
    assert.match(source, /共 {{ total }} 条/)
    assert.match(source, /列表工具栏/)
  }
  const customer = read('../app/components/AltocCustomersPage.vue')
  assert.match(customer, /UPopover v-model:open="filtersOpen"/)
  assert.match(customer, /activeFilterCount/)
  assert.match(customer, /v-if="hasListFilters"/)
  assert.match(customer, /保存本机视图/)
  assert.doesNotMatch(customer, /列设置|@update:model-value="[^"]*saveColumns\(\)/)
  assert.doesNotMatch(customer, />\s*客户列表\s*</)
  assert.match(customer, /sm:hidden/)
  assert.match(customer, /UFieldGroup/)
  assert.match(read('../app/components/AltocCustomerContacts.vue'), /AltocListColumns/)
  assert.match(read('../app/components/AltocQuotationsPage.vue'), /AltocListColumns/)
})
test('column view persists only enumerated column keys, respects scope and does not auto-save checkbox changes', () => {
  const source = read('../app/components/AltocListColumns.vue')
  const script = parse(source).descriptor.scriptSetup.content.replace(/import.meta.client/g, 'true')
  const stored = new Map(), columns = [{ key: 'status', label: '状态' }]
  const model = { value: ['status'] }, scope = { value: 'synthetic-scope' }, status = { value: 'ready' }, error = { value: null }
  let watchCallback
  const code = ts.transpileModule(`${script}\nreturn {save}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  const context = { defineProps: () => ({ name: 'fixture', columns }), defineModel: () => model, useState: () => scope, useEnterpriseNavigationAccess: () => ({ status }), usePermissions: () => ({ error }), watch: (_, callback) => {
    watchCallback = callback
  }, defineExpose: () => {}, window: { localStorage: { setItem: (key, value) => stored.set(key, value), getItem: key => stored.get(key), removeItem: key => stored.delete(key) } } }
  const h = new Function(...Object.keys(context), code)(...Object.values(context))
  h.save()
  assert.equal(stored.get('apf-list-columns:v1:fixture:synthetic-scope'), '["status"]')
  stored.set('apf-list-columns:v1:fixture:new-scope', '["status","unknown"]')
  watchCallback('new-scope', 'synthetic-scope')
  assert.deepEqual(model.value, ['status'])
  assert.equal(stored.has('apf-list-columns:v1:fixture:synthetic-scope'), false)
  scope.value = ''
  h.save()
  assert.equal(stored.size, 1)
  scope.value = 'denied'
  error.value = 'unavailable'
  h.save()
  assert.equal(stored.size, 1)
  assert.doesNotMatch(source, /@update:model-value="[^"]*save\(/)
})
test('approval titles use shared header and detail retains registered return action', () => {
  assert.match(read('../app/pages/enterprise/approvals/index.vue'), /<ContentPageHeader/)
  const detail = read('../app/pages/enterprise/approvals/[id].vue')
  assert.match(detail, /<ContentPageHeader/)
  assert.match(detail, /:to="backTo"/)
  assert.match(detail, /返回待办/)
})
