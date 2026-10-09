import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import { financeBusinessDate, financeDateRange, financeViewColumns, financeListRouteQuery, financeViewFilters, financeRecordedTime } from '../app/utils/financeWorkbench.ts'

test('business date ranges cross UTC midnight in Shanghai and retain 30 calendar days', () => {
  const now = new Date('2026-12-31T16:01:00Z')
  assert.equal(financeBusinessDate(now), '2027-01-01')
  assert.deepEqual(financeDateRange(30, now), { startDate: '2026-12-03', endDate: '2027-01-01' })
})
test('saved columns strip injected secret fields, object data, unknown keys and duplicates', () => {
  assert.deepEqual(financeViewColumns(['owner', 'accountNo', 'account_no_secret_ref', 'sort', 'owner', { code: 'secret' }], ['owner', 'sort']), ['owner', 'sort'])
  assert.deepEqual(financeViewColumns({ accountNo: 'secret' }, ['owner']), [])
})
test('B3 complete SFCs compile and import shared components explicitly', () => {
  for (const file of ['FinanceColumnView.vue', 'LegalEntityDetails.vue', 'LegalEntitiesPage.vue', 'FinanceListPage.vue', 'BankAccountDetails.vue', 'BalanceRegister.vue']) {
    const source = readFileSync(new URL(`../app/components/host/${file}`, import.meta.url), 'utf8')
    const { descriptor, errors } = parse(source, { filename: file })
    assert.deepEqual(errors, [])
    const script = compileScript(descriptor, { id: file })
    assert.deepEqual(compileTemplate({ source: descriptor.template!.content, filename: file, id: file, compilerOptions: { bindingMetadata: script.bindings } }).errors, [])
    for (const shared of ['ContentPageHeader', 'CommonEmptyState', 'SourceRecordInfo']) {
      if (source.includes(`<${shared}`)) assert.match(source, new RegExp(`import ${shared} from`))
    }
  }
})
test('entities use paginated contract and authorized account projection, never all-page collection', () => {
  const source = readFileSync(new URL('../app/components/host/LegalEntitiesPage.vue', import.meta.url), 'utf8')
  assert.match(source, /useFinancePagedList<LegalEntity>\(query => api.entities\(query\), canView,/)
  assert.doesNotMatch(source, /for \(let page|items.value.filter|rows.push/)
  assert.match(source, /共 {{ total }} 条/)
  assert.match(source, /UPagination/)
  const detail = readFileSync(new URL('../app/components/host/LegalEntityDetails.vue', import.meta.url), 'utf8')
  assert.match(detail, /hasPermission\('bank_accounts', 'view'\)/)
  assert.match(detail, /legalEntityCode: props.code/)
  assert.doesNotMatch(detail, /api.account\(/)
})
test('save view stays inside the columns popover and restores only scoped whitelist keys', () => {
  const source = readFileSync(new URL('../app/components/host/FinanceColumnView.vue', import.meta.url), 'utf8')
  assert.match(source, /<template #content>[\s\S]*保存视图[\s\S]*<\/template>/)
  assert.match(source, /encodeURIComponent\(scope\)/)
  assert.match(source, /financeViewColumns\(saved\?\.columns/)
  assert.doesNotMatch(source, /accountNo|secretRef|JSON.stringify\(props/)
})

test('list URL restores only supported filters, valid dates and bounded page numbers', () => {
  assert.deepEqual(financeListRouteQuery({ page: '3', status: 'active', accountType: 'bank', legalEntityCode: 'LE-1', secretRef: 'secret' }, 'accounts'), { page: '3', status: 'active', legalEntityCode: 'LE-1', accountType: 'bank' })
  assert.deepEqual(financeListRouteQuery({ page: '-1', status: 'closed', startDate: '2026-02-30', endDate: '2026-03-01', accountCode: 'BA-1' }, 'snapshots'), { accountCode: 'BA-1', endDate: '2026-03-01' })
  assert.deepEqual(financeListRouteQuery({ page: ['2'], status: 'closed', legalEntityCode: 'LE-1' }, 'entities'), {})
})

test('saved views retain only supported enum/date filters, never search or object identity', () => {
  assert.deepEqual(financeViewFilters({ status: 'active', accountType: 'bank', startDate: '2026-02-30', endDate: '2026-03-01', search: 'personal', accountCode: 'secret' }), { status: 'active', accountType: 'bank', endDate: '2026-03-01' })
  assert.deepEqual(financeViewFilters(null), {})
})

test('actual legal entity page restores page/search, performs one read per page and fences permissions', async () => {
  const ts = await import('typescript')
  const vue = await import('vue')
  const { createHostFinanceClient } = await import('../app/utils/hostFinanceClient.ts')
  const { createFinanceIntent, financeWriteMessage } = await import('../app/utils/hostFinanceForms.ts')
  const strip = (source: string) => {
    const ast = ts.createSourceFile('page.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    return ast.statements.filter(node => !ts.isImportDeclaration(node)).map(node => node.getText(ast)).join('\n').replace('export function', 'function')
  }
  const pageSource = parse(readFileSync(new URL('../app/components/host/LegalEntitiesPage.vue', import.meta.url), 'utf8')).descriptor.scriptSetup!.content
  const listSource = readFileSync(new URL('../app/composables/useFinancePagedList.ts', import.meta.url), 'utf8')
  const code = ts.transpileModule(`${strip(listSource)}\n${strip(pageSource)}\nreturn { page, status, items, total, error, pending }`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  const loaded = vue.ref(false), permitted = vue.ref(true), scopeKey = vue.ref('synthetic-user')
  const calls: Record<string, unknown>[] = []
  const context = {
    ref: vue.ref, reactive: vue.reactive, computed: vue.computed, watch: vue.watch, onScopeDispose: vue.onScopeDispose, onMounted: () => {}, useState: () => scopeKey,
    useRoute: () => ({ query: { page: '3', search: 'fixture' } }), useRouter: () => ({ replace: () => {} }),
    useFinanceModule: () => ({ hosted: true, apiUrl: (path: string) => path, sessionScope: scopeKey }),
    usePermissions: () => ({ loaded, error: vue.ref(null), hasPermission: () => permitted.value, loadPermissions: () => {} }),
    useDebouncedSearch: ({ initial, onChange }: { initial?: string, onChange: () => void }) => {
      const search = vue.ref(initial || ''), debounced = vue.ref(initial || '')
      return { search, debounced, flush: () => {
        debounced.value = search.value
        onChange()
      } }
    },
    useToast: () => ({ add: () => {} }), useConfirm: () => ({ confirm: () => false }),
    financeListRouteQuery, createHostFinanceClient, createFinanceIntent, financeWriteMessage,
    $fetch: async (_url: string, options: { query: Record<string, unknown> }) => {
      calls.push(options.query)
      return { data: [{ id: Number(options.query.page), code: 'LE-FIXTURE', name: '合成法人主体' }], total: 45, page: options.query.page, pageSize: 20 }
    }
  }
  const scope = vue.effectScope()
  const entries = Object.entries(context).filter(([key]) => /^[A-Za-z_$][\w$]*$/.test(key))
  const state = scope.run(() => new Function(...entries.map(([key]) => key), code)(...entries.map(([, value]) => value)))!
  try {
    assert.equal(calls.length, 0)
    loaded.value = true
    await vue.nextTick()
    await vue.nextTick()
    assert.deepEqual(calls, [{ page: 3, pageSize: 20, search: 'fixture' }])
    assert.equal(state.total.value, 45)
    state.page.value = 2
    await vue.nextTick()
    await vue.nextTick()
    assert.equal(calls.length, 2)
    assert.equal(calls[1]!.page, 2)
    state.status.value = 'inactive'
    await vue.nextTick()
    await vue.nextTick()
    assert.equal(calls.length, 3)
    assert.equal(calls[2]!.page, 1)
    assert.equal(calls[2]!.status, 'inactive')
    permitted.value = false
    await vue.nextTick()
    assert.equal(calls.length, 3)
    assert.deepEqual(state.items.value, [])
    assert.equal(state.total.value, 0)
  } finally { scope.stop() }
})

test('UTC balance-entry SQL timestamps display Shanghai business time without browser timezone drift', () => {
  assert.equal(financeRecordedTime('2026-12-31 16:01:00.000'), financeRecordedTime('2026-12-31T16:01:00.000Z'))
  assert.match(financeRecordedTime('2026-12-31 16:01:00.000'), /2027.*01.*01.*00:01:00/)
  assert.equal(financeRecordedTime('invalid'), '-')
})
