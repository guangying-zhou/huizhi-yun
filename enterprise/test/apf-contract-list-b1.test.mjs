import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import { ref, reactive, computed, watch, onScopeDispose, effectScope, nextTick } from 'vue'
import * as list from '../app/utils/altocContractList.ts'
import * as presentation from '../app/utils/w3Presentation.ts'

const ts = createRequire(import.meta.url)('typescript')
const source = readFileSync(new URL('../app/components/AltocContractsPage.vue', import.meta.url), 'utf8')
function harness(fetcher, query = {}) {
  const tree = ts.createSourceFile('contracts.ts', parse(source).descriptor.scriptSetup.content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const content = tree.statements.filter(n => !ts.isImportDeclaration(n)).map(n => n.getText(tree)).join('\n')
  const code = ts.transpileModule(content + '\nreturn { rows, total, summary, page, search, debounced, flush, signedDateFrom, signedDateTo, listView, originFilter, load, error, pending, clearListFilters, listQuery, dateError, pageSize, statusFilter, customerFilter, ownerFilter, amountMin, amountMax }', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  const route = reactive({ params: {}, query }), cache = ref('synthetic-tenant:user:policy'), status = ref('ready')
  const calls = [], scope = effectScope()
  const context = { ...list, ...presentation, ref, reactive, computed, watch, onScopeDispose, nextTick,
    defineProps: () => ({ detail: false }), onMounted: fn => fn(), useRoute: () => route,
    useRouter: () => ({ replace: async ({ query }) => { route.query = Object.fromEntries(Object.entries(query).map(([k, v]) => [k, String(v)])) } }),
    usePermissions: () => ({ loaded: ref(true), error: ref(''), hasPermission: () => false, loadPermissions: async () => {} }),
    useEnterpriseNavigationAccess: () => ({ status }), useState: () => cache,
    useDebouncedSearch: ({ initial, onChange }) => {
      const search = ref(initial), debounced = ref(initial)
      return { search, debounced, flush: () => {
        if (debounced.value !== search.value) {
          debounced.value = search.value
          onChange()
        }
      } }
    },
    useToast: () => ({ add: () => {} }), useConfirm: () => ({ confirm: async () => false }), createConsoleMutationIntent: () => ({}),
    useAltocDirectoryLabels: () => ({ userName: () => '合成人员', departmentName: () => '合成部门', directoryError: ref(false) }),
    altocContractStatusLabels: {}, formatMoney: v => v,
    $fetch: async (path, options) => {
      calls.push({ path, query: { ...options.query } })
      return fetcher(options.query)
    }
  }
  const result = scope.run(() => new Function(...Object.keys(context), code)(...Object.values(context)))
  return { ...result, calls, route, cache, status, stop: () => scope.stop() }
}
const response = (query, id = 1) => ({ data: { items: [{ id, name: '合成合同' }], total: 45, page: query.page, pageSize: query.pageSize, summary: { count: 45, amounts: [] } } })
const settle = async () => {
  await nextTick()
  await new Promise(r => setTimeout(r, 0))
  await nextTick()
}

test('B1 SFC compiles and keeps paging, loading, summaries, mobile overflow and distinct amounts', () => {
  const { descriptor } = parse(source)
  const compiled = compileScript(descriptor, { id: 'b1' })
  assert.deepEqual(compileTemplate({ source: descriptor.template.content, filename: 'contracts.vue', id: 'b1', compilerOptions: { bindingMetadata: compiled.bindings } }).errors, [])
  for (const token of ['ContentPageHeader', 'useDebouncedSearch', '@keyup.enter="flush"', ':loading="pending || (!loaded && !permissionError)"', 'CommonEmptyState', '共 {{ total }} 条', ':total="total"', ':items-per-page="pageSize"', 'show-edges', 'show-controls', 'aria-label="每页条数"', '#customer_name-cell', 'lg:grid-cols-3', 'v-model="detailTab"', 'max-w-full overflow-x-auto', 'v-model:open="filtersOpen"', 'contractEffectiveAmount(row.original).label']) assert.ok(source.includes(token), token)
  assert.ok(!source.includes('rows.value.sort('))
  assert.deepEqual(list.contractListAmount({ origin_type: 'historical_import', signed_amount: null, amount_tax_inclusive: '100.00' }), { value: null, label: '原签约额' })
  assert.deepEqual(list.contractListAmount({ amount_tax_inclusive: '0.00' }), { value: '0.00', label: '当前合同额' })
})
test('B1 query omits unset dates, validates calendar days and dynamic year view', () => {
  const base = list.contractListState({ page: '2' })
  assert.deepEqual(list.contractListQuery(base, 2026), { page: 2, pageSize: 20 })
  assert.equal(list.contractListState({ signedDateFrom: '2026-02-30', page: 'invalid' }).signedDateFrom, '')
  assert.equal(list.validContractCalendarDate('2024-02-29'), true)
  assert.deepEqual(list.contractListQuery({ ...base, view: 'this-year' }, 2027), { page: 2, pageSize: 20, signedDateFrom: '2027-01-01', signedDateTo: '2027-12-31' })
})
test('B1 restores URL pages and filters, fetches one page, resets changed filters and returns from details', async () => {
  const h = harness(response, { page: '3', origin: 'historical_import', signedDateFrom: '2026-01-01', search: '合成' })
  try {
    await settle()
    assert.equal(h.calls.length, 1)
    assert.equal(h.calls[0].query.page, 3)
    assert.equal(h.calls[0].query.signedDateFrom, '2026-01-01')
    h.signedDateTo.value = '2026-12-31'
    await settle()
    assert.equal(h.page.value, 1)
    h.route.query = { page: '2', signedDateFrom: '2026-02-01' }
    await settle()
    assert.equal(h.page.value, 2)
    assert.equal(h.listQuery.value.signedDateFrom, '2026-02-01')
    h.search.value = '另一合同'
    await settle()
    const count = h.calls.length
    assert.equal(h.calls.length, count)
    h.flush()
    await settle()
    assert.equal(h.page.value, 1)
    h.clearListFilters()
    await settle()
    assert.deepEqual(h.listQuery.value, { page: 1, pageSize: 20 })
  } finally { h.stop() }
})
test('B1 preserves loaded rows during refresh, rejects stale responses and clears scope/403 caches', async () => {
  let release, fail = 0
  const h = harness(async (query) => {
    if (fail) throw { statusCode: fail }
    if (query.page === 2) {
      return new Promise((r) => {
        release = () => r(response(query, 2))
      })
    }
    return response(query)
  })
  try {
    await settle()
    h.page.value = 2
    await settle()
    assert.equal(h.rows.value[0].id, 1)
    assert.equal(h.pending.value, true)
    h.page.value = 3
    await settle()
    release()
    await settle()
    assert.equal(h.rows.value[0].id, 1)
    assert.equal(h.page.value, 3)
    fail = 503
    await h.load()
    assert.match(h.error.value, /暂不可用/)
    assert.equal(h.rows.value.length, 1)
    fail = 403
    await h.load()
    assert.equal(h.rows.value.length, 0)
    assert.equal(h.summary.value, null)
    assert.equal(h.total.value, 0)
    fail = 0
    await h.load()
    h.cache.value = ''
    await settle()
    assert.equal(h.rows.value.length, 0)
    assert.equal(h.total.value, 0)
  } finally { h.stop() }
})

test('B1 local preferences accept only closed views and columns without personal search or objects', () => {
  assert.deepEqual(list.contractListPreference({ view: 'this-year', columns: ['owner_uid', 'secret', 'owner_uid'], expanded: true, search: 'private text', signedDateFrom: '2025-01-01', rows: [{ name: 'private' }] }), { columns: ['owner_uid'], expanded: true })
  assert.equal(Object.hasOwn(list.contractListPreference({ view: 'unknown' }), 'view'), false)
  assert.ok(!source.includes('同筛选、同权限范围'))
  assert.deepEqual(list.contractEffectiveAmount({ effective_amount: null, signed_amount: '100.00', origin_type: 'historical_import' }), { value: '100.00', label: '原签约额', fallback: true })
  assert.deepEqual(list.contractEffectiveAmount({ effective_amount: '0.00' }), { value: '0.00', label: '有效合同额', fallback: false })
  assert.match(source, /localStorage\.removeItem\(preferenceKey\(oldScope\)\)/)
})

test('B1 server filters and page size reset pagination and preserve URL values', async () => {
  const h = harness(response, { page: '3' })
  try {
    await settle()
    h.pageSize.value = 50
    h.ownerFilter.value = 'person'
    h.customerFilter.value = '7'
    h.amountMin.value = '10.01'
    h.amountMax.value = '30.00'
    h.statusFilter.value = 'effective'
    await settle()
    assert.equal(h.page.value, 1)
    assert.deepEqual(h.calls.at(-1).query, { page: 1, pageSize: 50, status: 'effective', customerId: '7', ownerUid: 'person', amountMin: '10.01', amountMax: '30.00' })
    assert.equal(h.total.value, 45)
    assert.equal(list.contractAmountRangeError('30.00', '10.00'), '最低金额不能高于最高金额')
    assert.equal(list.contractAmountRangeError('1e2', ''), '金额须为非负数，最多两位小数')
  } finally { h.stop() }
})
