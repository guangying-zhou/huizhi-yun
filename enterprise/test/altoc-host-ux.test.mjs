import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import { validateCustomerFields, altocValidationMessage } from '../app/utils/altocHostForms.ts'

test('Customer required fields and length errors precede submission; safe errors never expose server text', () => {
  assert.deepEqual(validateCustomerFields('customer', ['name', 'owner_uid'], { name: ' ', owner_uid: '' }), { name: '请填写此必填项', owner_uid: '请选择负责人' })
  assert.deepEqual(validateCustomerFields('customer', ['name', 'owner_uid'], { name: '新客户', owner_uid: 'actor' }), {})
  assert.deepEqual(validateCustomerFields('customer', ['name'], { name: '已有客户' }), {}, 'edit does not add an owner mutation')
  assert.ok(validateCustomerFields('contact', ['name'], { name: '' }).name)
  assert.ok(validateCustomerFields('contact', ['name'], { name: '字'.repeat(51) }).name)
  assert.ok(validateCustomerFields('customer', ['description'], { description: '一行\n二行' }).description)
  assert.ok(validateCustomerFields('owner', ['owner_uid'], { owner_uid: 'x'.repeat(65) }).owner_uid)
  assert.ok(validateCustomerFields('invoice', ['taxpayer_name', 'invoice_type'], { taxpayer_name: '', invoice_type: '' }).taxpayer_name)
  assert.equal(altocValidationMessage({ statusCode: 400, data: { message: 'sensitive SQL' } }).includes('sensitive'), false)
  assert.match(altocValidationMessage({ statusCode: 400 }), /格式不正确/)
  assert.match(altocValidationMessage({ statusCode: 409 }), /版本/)
  assert.match(altocValidationMessage({ statusCode: 403 }), /无权/)
})

test('Foundation directory resolves exact uid/name and departments without leaking codes; scope change clears caches', async () => {
  const callbacks = []
  const scope = { value: 'actor-scope' }
  globalThis.ref = value => ({ value })
  globalThis.computed = fn => ({ get value() {
    return fn()
  } })
  globalThis.useState = () => scope
  globalThis.watch = (source, fn) => callbacks.push({ source, fn })
  globalThis.onMounted = () => {}
  globalThis.onScopeDispose = () => {}
  const requested = []
  let fail = false
  globalThis.$fetch = async (path) => {
    requested.push(path)
    if (fail) throw Error('raw failure')
    return path.includes('/users/') ? { code: 0, data: [{ uid: 'Person', realName: '王明' }] } : { code: 0, data: { tree: [{ deptCode: 'D1', name: '经营部' }] } }
  }
  const hooks = registerHooks({ resolve(specifier, context, next) {
    if (specifier.endsWith('/useHostDirectoryLabels')) return next(specifier + '.ts', context)
    if (specifier.endsWith('/sharedApiPath')) return { url: 'data:text/javascript,' + encodeURIComponent('export const sharedApiPath=p=>`/enterprise${p}`'), shortCircuit: true }
    if (specifier.endsWith('/reservedDirectorySubject')) return next(specifier + '.ts', context)
    return next(specifier, context)
  } })
  try {
    const { useAltocDirectoryLabels } = await import('../app/composables/useAltocDirectoryLabels.ts')
    const directory = useAltocDirectoryLabels({ value: ['Person', 'Person'] })
    await Promise.all([directory.refresh(false), directory.refresh(false), directory.refresh(false)])
    assert.equal(requested.length, 2, 'concurrent refresh coalesces users and departments')
    assert.equal(directory.userName('Person'), '王明')
    assert.equal(directory.departmentName('D1'), '经营部')
    assert.equal(requested.filter(p => p.includes('/users/')).length, 1)
    assert.ok(requested.every(p => p.startsWith('/enterprise/api/directory/')))
    scope.value = 'different-actor'
    callbacks.find(c => c.source === scope).fn()
    fail = true
    await directory.refresh()
    const failedBatchCount = requested.filter(p => p.includes('/users/')).length
    const failedTotal = requested.length
    await Promise.all([directory.refresh(false), directory.refresh(false), directory.refresh(false)])
    assert.equal(requested.filter(p => p.includes('/users/')).length, failedBatchCount, 'reactive failures are not automatically retried')
    assert.equal(requested.length, failedTotal, 'department failures also wait for explicit retry')
    assert.equal(directory.directoryError.value, true)
    assert.notEqual(directory.userName('Person'), 'Person')
    assert.notEqual(directory.userName('Person'), '王明')
    assert.notEqual(directory.departmentName('D1'), 'D1')
  } finally {
    hooks.deregister()
    for (const key of ['ref', 'computed', 'useState', 'watch', 'onMounted', 'onScopeDispose', '$fetch']) delete globalThis[key]
  }
})

for (const [name, breadcrumb] of [['Customers', '销售 / 客户经营 / 客户'], ['Quotations', '销售 / 报价与投标 / 报价'], ['Contracts', '销售 / 合同管理 / 合同']]) {
  test(`Altoc ${name} preserves workflow boundaries, descriptions and narrow-screen layout`, () => {
    const source = readFileSync(new URL(`../app/components/Altoc${name}Page.vue`, import.meta.url), 'utf8')
    const { descriptor, errors } = parse(source)
    assert.deepEqual(errors, [])
    const script = compileScript(descriptor, { id: name })
    const compiled = compileTemplate({ source: descriptor.template.content, filename: name + '.vue', id: name, compilerOptions: { bindingMetadata: script.bindings } })
    assert.deepEqual(compiled.errors, [])
    for (const fact of [breadcrumb, 'description=', 'sm:max-w-', 'grid-cols-1', 'sm:grid-cols-2', 'variant="outline"', 'UBadge', 'formError', 'canEdit', 'Idempotency-Key', 'createConsoleMutationIntent']) assert.ok(source.includes(fact), fact)
    if (name === 'Customers') {
      for (const fact of ['USlideover', 'editorTitle', '基本信息', '联系方式', '归属', 'validateCustomerFields', 'fieldErrors[key]', 'UserTreeSelector', 'APFDepartmentSelect', 'SOURCE_TYPE_OPTIONS', 'CREDIT_LEVEL_OPTIONS', 'String(currentUser.value', 'showOptional', 'userName(row.original.owner_uid)']) assert.ok(source.includes(fact), fact)
      assert.ok(source.indexOf('validateCustomerFields(mode.value', source.indexOf('async function save')) < source.indexOf('await send', source.indexOf('async function save')))
      assert.equal(source.includes('编辑客户资料'), false)
    } else {
      for (const fact of ['formatMoney', 'text-right', 'tabular-nums', 'departmentName', 'userName']) assert.ok(source.includes(fact), fact)
      assert.equal(source.includes('transition(\'approve\')'), false)
    }
  })
}
