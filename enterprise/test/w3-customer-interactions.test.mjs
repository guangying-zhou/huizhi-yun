import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import { parse, compileScript } from '@vue/compiler-sfc'
import { ref, reactive, computed, watch, onScopeDispose, effectScope, nextTick } from 'vue'
import { contactStarLabels } from '../app/utils/w3Presentation.ts'
import { customerListState, customerListQuery, customerTab, customerTimeline } from '../app/utils/altocCustomerWorkspace.ts'
import { requireAltocJsonMutationResult } from '../app/utils/altocBusinessObjectPresentation.ts'

const ts = createRequire(import.meta.url)('typescript')
const built = await build({ entryPoints: [new URL('../../foundation/shared/utils/reviewMutationIntent.ts', import.meta.url).pathname], bundle: true, format: 'cjs', platform: 'node', write: false })
const utilities = { exports: {} }
new Function('module', 'exports', built.outputFiles[0].text)(utilities, utilities.exports)
const customer = { id: 1, name: '合成客户', row_version: 4, parent_customer_id: null, primary_contact_id: null }
const contact = { id: 3, code: 'CN-SYNTHETIC', name: '合成联系人', status: 'active', row_version: 2, star_level: null }
function harness(file, fetcher, fields, props, confirmation = async () => true) {
  const source = readFileSync(new URL(`../app/components/${file}`, import.meta.url), 'utf8')
  const program = ts.createSourceFile(file, parse(source).descriptor.scriptSetup.content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const script = program.statements.filter(node => !ts.isImportDeclaration(node)).map(node => node.getText(program)).join('\n')
  const code = ts.transpileModule(script + `\nreturn { ${fields} }`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  const cache = ref('synthetic-session'), permission = ref(true), emitted = [], permissionChecks = []
  const context = { ...utilities.exports, contactStarLabels, useDebouncedSearch: ({ onChange } = {}) => {
    const search = ref('')
    if (onChange) watch(search, onChange)
    return { search, debounced: search, flush: () => {} }
  }, requireAltocJsonMutationResult, ref, reactive, computed, watch, onScopeDispose, nextTick, defineExpose: () => {}, defineProps: () => props, defineEmits: () => event => emitted.push(event), usePermissions: () => ({ loaded: ref(true), error: ref(''), hasPermission: (resource, action) => {
    permissionChecks.push([resource, action])
    return permission.value
  } }), useState: () => cache, useEnterpriseNavigationAccess: () => ({ status: ref('ready') }), useAltocDirectoryLabels: () => ({ userName: () => '合成人员' }), useConfirm: () => ({ confirm: confirmation }), useToast: () => ({ add: () => {} }), $fetch: fetcher }
  const scope = effectScope()
  const value = scope.run(() => new Function(...Object.keys(context), code)(...Object.values(context)))
  return { ...value, cache, permission, emitted, permissionChecks, stop: () => scope.stop() }
}
function actions(fetcher, confirm) {
  return harness('W3CustomerActions.vue', fetcher, 'begin, save, open, mode, selection, version, error, comparison, adopt', { customer, contacts: [contact] }, confirm)
}
test('W3 customer SFCs compile with imported Foundation states and hierarchy/search/privacy and contact controls are wired', () => {
  for (const file of ['AltocCustomersPage.vue', 'W3CustomerHierarchy.vue', 'W3CustomerActions.vue', 'W3CustomerOverview.vue', 'W3ChildContracts.vue', 'AltocCustomerContacts.vue', 'AltocCustomerContracts.vue']) {
    const source = readFileSync(new URL(`../app/components/${file}`, import.meta.url), 'utf8')
    const { descriptor, errors } = parse(source, { filename: file })
    assert.deepEqual(errors, [])
    assert.doesNotThrow(() => compileScript(descriptor, { id: file, inlineTemplate: true }))
    if (source.includes('<CommonEmptyState')) assert.match(source, /import CommonEmptyState from/)
    assert.doesNotMatch(source, /hiddenChildCount|hiddenCount|window\.(confirm|alert)/)
  }
  const source = readFileSync(new URL('../app/components/AltocCustomersPage.vue', import.meta.url), 'utf8')
  assert.match(source, /watch\(search[\s\S]*view.value = 'list'/)
  assert.match(source, /部分上级无权查看/)
  assert.match(readFileSync(new URL('../app/components/AltocCustomerContacts.vue', import.meta.url), 'utf8'), /primary_contact_id[\s\S]*关键联系人/)
  assert.match(source, /请先更换或清空主联系人/)
  for (const component of ['ContentPageHeader', 'CommonEmptyState', 'UserTreeSelector']) assert.ok(source.includes(`import ${component} from '../../../foundation/app/components/`), component)
  assert.match(source, /客户等级：[\s\S]*customer_level_id[\s\S]*未定级/)
  assert.doesNotMatch(source, /客户等级：[^\n]*customer.credit_level/)
})
test('hierarchy pages roots, loads children in bounded batches only on demand and drills on mobile without hidden counts', async () => {
  const calls = []
  const h = harness('W3CustomerHierarchy.vue', async (_, options) => {
    calls.push(options.query)
    return { data: { items: options.query.parentId ? Array.from({ length: options.query.page === 1 ? 50 : 1 }, (_, i) => ({ id: 2 + i + (options.query.page - 1) * 50, name: `合成下属${i}`, childCount: 0 })) : [{ id: 1, name: '合成根客户', childCount: 51, hasHiddenChildren: true }], total: options.query.parentId ? 51 : 1 } }
  }, 'expand, drill, back, roots, displayed, path, page, branches, load', reactive({ statusFilter: 'all', ownerUnassigned: false }))
  try {
    await nextTick()
    assert.equal(calls.length, 1)
    assert.deepEqual(calls[0], { page: 1, pageSize: 20, rootsOnly: true })
    await h.expand(h.roots.value[0])
    assert.deepEqual(calls[1], { page: 1, pageSize: 50, parentId: '1' })
    assert.equal(h.displayed.value.length, 51)
    await h.expand(h.roots.value[0], true)
    assert.equal(calls[2].page, 2)
    assert.equal(h.displayed.value.length, 52)
    await h.expand(h.roots.value[0])
    assert.equal(calls.length, 3, 'collapse uses cached branch, no whole-tree read')
    assert.equal(h.displayed.value.length, 1)
    h.drill(h.roots.value[0])
    await nextTick()
    assert.equal(calls.at(-1).parentId, '1')
    assert.equal(calls.at(-1).pageSize, 50)
    h.back(0)
    await nextTick()
    assert.equal(calls.at(-1).rootsOnly, true)
    h.permission.value = false
    await nextTick()
    assert.equal(h.displayed.value.length, 0)
  } finally { h.stop() }
})
test('hierarchy clears old scope caches and discards an in-flight child response', async () => {
  let resolveChild
  const h = harness('W3CustomerHierarchy.vue', async (_, { query }) => query.parentId
    ? await new Promise((resolve) => {
        resolveChild = resolve
      })
    : { data: { items: [{ id: 1, name: '合成根', childCount: 1 }], total: 1 } }, 'expand, roots, displayed, branches', reactive({ statusFilter: 'all', ownerUnassigned: false }))
  try {
    await nextTick()
    const pending = h.expand(h.roots.value[0])
    h.cache.value = 'new-synthetic-session'
    resolveChild({ data: { items: [{ id: 8, name: 'OLD-SCOPE-MUST-NOT-LEAK' }], total: 1 } })
    await pending
    await nextTick()
    assert.ok(!JSON.stringify(h.displayed.value).includes('OLD-SCOPE'))
    assert.deepEqual(h.branches.value, {})
  } finally { h.stop() }
})
test('parent, primary and star use exact existing contracts, distinct versions and reversible nulls', async () => {
  const writes = [], confirms = []
  const h = actions(async (path, options) => {
    if (options.query) return { data: { items: [contact], total: 1 } }
    writes.push({ path, ...options })
    return { data: customer }
  }, async (options) => {
    confirms.push({ ...options, editorOpen: h.open.value })
    return true
  })
  try {
    h.begin('parent')
    h.selection.value = '5'
    await h.save()
    assert.equal(writes[0].path, '/altoc/api/v1/customers/1/parent')
    assert.deepEqual(writes[0].body, { expectedVersion: 4, parent_customer_id: '5' })
    h.begin('primary')
    h.selection.value = '3'
    await h.save()
    assert.equal(writes[1].path, '/altoc/api/v1/customers/1/primary-contact')
    assert.deepEqual(writes[1].body, { expectedVersion: 4, primary_contact_id: '3' })
    assert.equal(confirms[0].editorOpen, false)
    assert.equal(confirms[0].tone, 'warning')
    assert.match(confirms[0].message, /合成联系人.*原主联系人将被替换/)
    h.begin('primary')
    await h.save()
    assert.equal(writes[2].body.primary_contact_id, null)
    h.begin('star', contact)
    h.selection.value = '3'
    await h.save()
    assert.equal(writes[3].path, '/altoc/api/v1/customers/1/contacts/CN-SYNTHETIC')
    assert.deepEqual(writes[3].body, { expectedVersion: 2, star_level: 3 })
    h.begin('star', contact)
    await h.save()
    assert.equal(writes[4].body.star_level, null)
    assert.ok(writes.every(write => write.headers['Idempotency-Key']))
  } finally { h.stop() }
})
test('CAS refresh retains selection and accepting current version creates a fresh intent, transport retry retains original key', async () => {
  const writes = []
  let conflict = true, lost = false
  const h = actions(async (path, options) => {
    if (!options?.method) return { data: { ...customer, row_version: 8 } }
    writes.push({ path, ...options })
    if (conflict) {
      conflict = false
      throw { statusCode: 409, data: { code: 'altoc_customer_version_conflict' } }
    }
    if (lost) {
      lost = false
      throw Error('synthetic transport loss')
    }
    return { data: customer }
  })
  try {
    h.begin('parent')
    h.selection.value = '5'
    await h.save()
    assert.equal(h.open.value, true)
    assert.equal(h.selection.value, '5')
    assert.equal(h.comparison.value.row_version, 8)
    h.adopt()
    await h.save()
    assert.equal(writes[1].body.expectedVersion, 8)
    assert.notEqual(writes[0].headers['Idempotency-Key'], writes[1].headers['Idempotency-Key'])
    h.begin('parent')
    h.selection.value = '6'
    lost = true
    await h.save()
    await h.save()
    assert.deepEqual(writes[2], writes[3])
  } finally { h.stop() }
})
test('cancelled confirmation, missing edit and session change during confirmation cannot write', async () => {
  let finish
  const writes = []
  const h = actions(async (...args) => {
    writes.push(args)
    return { data: customer }
  }, () => new Promise((resolve) => {
    finish = resolve
  }))
  try {
    h.permission.value = false
    await nextTick()
    h.begin('parent')
    await h.save()
    assert.equal(writes.length, 0)
    h.permission.value = true
    await nextTick()
    h.begin('primary')
    const pending = h.save()
    await nextTick()
    h.cache.value = 'different-session'
    finish(true)
    await pending
    assert.equal(writes.length, 0)
    assert.equal(h.open.value, false)
  } finally { h.stop() }
})

test('snapshot comparisons use server rollup counts and never add currency amounts across currencies', async () => {
  const rollup = { count: 2, amounts: [{ currency_code: 'CNY', count: 2, amount: '5.00' }], signedLast12Months: [{ currency_code: 'CNY', count: 1, amount: '2.00' }, { currency_code: 'USD', count: 1, amount: '1.00' }], signedThisYear: [{ currency_code: 'CNY', count: 1, amount: '2.00' }] }
  const h = harness('W3CustomerOverview.vue', async path => path.endsWith('/contracts') ? { data: { rollup } } : { data: { items: [], total: 0 } }, 'snapshotCurrent, loadSummaries, summaryError', { customer })
  try {
    await nextTick()
    await nextTick()
    await h.loadSummaries()
    assert.equal(h.snapshotCurrent.value.contract_count_1y, 2)
    assert.equal(h.snapshotCurrent.value.contract_count_ytd, 1)
    assert.equal(h.snapshotCurrent.value.contract_amount_ytd, '2.00')
    assert.equal(Object.hasOwn(h.snapshotCurrent.value, 'contract_amount_1y'), false, 'mixed currencies stay untracked rather than silently summed')
    assert.equal(Object.hasOwn(h.snapshotCurrent.value, 'contract_count_3y'), false)
    assert.equal(Object.hasOwn(h.snapshotCurrent.value, 'receivable_amount_direct'), false)
  } finally { h.stop() }
})

test('child contracts use an independent contract read, paginate and fence scope changes', async () => {
  const calls = []
  const h = harness('W3ChildContracts.vue', async (_, options) => {
    calls.push(options.query)
    return { data: { items: [{ id: 2, name: '合成下级合同' }], total: 21, page: options.query.page, pageSize: 20 } }
  }, 'page, rows, total, error', { contractId: '1' })
  try {
    await nextTick()
    assert.deepEqual(calls[0], { parentContractId: '1', page: 1, pageSize: 20 })
    h.page.value = 2
    await nextTick()
    assert.equal(calls.at(-1).page, 2)
    h.permission.value = false
    await nextTick()
    assert.equal(h.rows.value.length, 0)
    assert.equal(calls.length, 2)
  } finally { h.stop() }
})
test('direct child summaries use one contract-authorized batch and never mix currencies', async () => {
  const calls = []
  const h = harness('W3CustomerOverview.vue', async (_, options) => {
    calls.push(options.query)
    if (options.query.parentId) return { data: { items: [{ id: 2, name: '合成下属' }, { id: 3, name: '合成下属二' }], total: 2 } }
    if (options.query.customerIds) return { data: { customerSummaries: { 2: { count: 2, amounts: [{ currency_code: 'CNY', count: 1, amount: '10.00' }, { currency_code: 'USD', count: 1, amount: '2.00' }] }, 3: { count: 0, amounts: [] } } } }
    return { data: { rollup: { count: 0, amounts: [] } } }
  }, 'childContracts, loadChildContracts, children', { customer })
  try {
    await nextTick()
    await nextTick()
    const batches = calls.filter(query => query.customerIds)
    assert.equal(batches.length, 1)
    assert.equal(batches[0].customerIds, '2,3')
    assert.equal(h.childContracts.value['2'].amounts.length, 2)
    h.permission.value = false
    await nextTick()
    assert.deepEqual(h.childContracts.value, {})
  } finally { h.stop() }
})

test('customer workspace restores bounded list filters, validates tabs and never invents audit facts', () => {
  const state = customerListState({ page: '3', search: ' 合成客户 ', ownerUid: 'synthetic-owner', industryCode: 'software', updatedDateFrom: '2026-01-01', customerSort: 'updated_desc' })
  assert.deepEqual(customerListQuery(state), { page: 3, pageSize: 20, customerSort: 'updated_desc', search: '合成客户', ownerUid: 'synthetic-owner', industryCode: 'software', updatedDateFrom: '2026-01-01' })
  assert.equal(customerTab('contacts'), 'contacts')
  assert.equal(customerTab('unknown'), 'basic')
  assert.deepEqual(customerTimeline({ name: '合成', created_at: '2026-01-01', source_info: { importedAt: '2026-01-02' } }), [{ label: '当前系统记录创建', at: '2026-01-01' }, { label: '迁入记录', at: '2026-01-02' }])
  assert.deepEqual(customerTimeline({}), [])
})
test('customer contacts page filters and pages on server, clears scope and rejects stale responses', async () => {
  const calls = []
  let resolveOld
  const props = reactive({ customer: { id: 1 }, canEdit: true })
  const h = harness('AltocCustomerContacts.vue', async (_url, { query }) => {
    calls.push(query)
    if (query.page === 2) return await new Promise((resolve) => {
      resolveOld = resolve
    })
    return { data: { id: String(props.customer.id), items: [{ id: 1, name: '合成联系人' }], total: 23, page: query.page, pageSize: 20 } }
  }, 'page, rows, total, view, decisionRole, openContact, drawer, selected, pending', props)
  try {
    await nextTick()
    assert.equal(h.total.value, 23)
    assert.deepEqual(calls[0], { page: 1, pageSize: 20 })
    h.view.value = 'starred'
    await nextTick()
    assert.equal(calls.at(-1).starredOnly, true)
    h.openContact(h.rows.value[0])
    assert.equal(h.drawer.value, true)
    h.page.value = 2
    await nextTick()
    h.cache.value = 'new-session'
    await nextTick()
    resolveOld({ data: { id: '1', items: [{ id: 9, name: 'OLD-SCOPE' }], total: 23, page: 2, pageSize: 20 } })
    await nextTick()
    assert.ok(!JSON.stringify(h.rows.value).includes('OLD-SCOPE'))
    assert.equal(h.drawer.value, false)
    h.permission.value = false
    await nextTick()
    assert.equal(h.total.value, 0)
    assert.deepEqual(h.rows.value, [])
    assert.equal(h.pending.value, false)
  } finally { h.stop() }
})
test('customer contract tab checks separate contract permission and only accepts matching bounded pages', async () => {
  const calls = []
  const props = reactive({ customerId: '1', active: false })
  const h = harness('AltocCustomerContracts.vue', async (_url, { query }) => {
    calls.push(query)
    return { data: { items: [], total: 2, page: query.page, pageSize: query.pageSize, rollup: { amounts: [{ currency_code: 'CNY', amount: '200.00' }] } } }
  }, 'page, rows, total, pending', props)
  try {
    await nextTick()
    assert.deepEqual(calls[0], { customerId: '1', page: 1, pageSize: 1 })
    assert.deepEqual(h.permissionChecks[0], ['contract', 'view'])
    assert.ok(h.permissionChecks.every(([resource]) => resource === 'contract'))
    props.active = true
    await nextTick()
    assert.equal(calls.at(-1).pageSize, 20)
    h.permission.value = false
    await nextTick()
    assert.equal(h.total.value, 0)
    assert.deepEqual(h.rows.value, [])
  } finally { h.stop() }
})
