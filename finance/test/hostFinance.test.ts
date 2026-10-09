/* eslint-disable @typescript-eslint/no-explicit-any -- VM exposes actual composable state for behavior tests. */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import test from 'node:test'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import { createHostFinanceClient, type FinanceFetchOptions } from '../app/utils/hostFinanceClient.ts'
import { financeDateRange, financeListRouteQuery } from '../app/utils/financeWorkbench.ts'
import { accountW3Patch } from '../app/utils/w3AccountForms.ts'
import { createFinanceIntent, decimalInput, financeWriteMessage, validEffectiveRange } from '../app/utils/hostFinanceForms.ts'
import { authorizationResourcesAllow } from '../../foundation/shared/utils/authorizationActions.ts'
import { formatMoney } from '../../foundation/app/utils/format.ts'

test('Finance typed transport preserves paging, encoded identity, versions and retry key', async () => {
  const requests: { url: string, options: FinanceFetchOptions }[] = []
  const api = createHostFinanceClient(async <T>(url: string, options: FinanceFetchOptions) => {
    requests.push({ url, options })
    return {} as T
  }, path => `/finance/api/v1${path}`)
  await api.accounts({ page: 2, pageSize: 20, search: '银行' })
  await api.snapshots({ page: 1, pageSize: 20, accountCode: 'BA1', startDate: '2026-10-01' })
  await api.updateAccount('BA/1', { status: 'inactive', expectedVersion: 3 }, 'same-intent')
  await api.updateAccount('BA/1', { status: 'inactive', expectedVersion: 3 }, 'same-intent')
  assert.equal(requests[0]!.options.query?.page, 2)
  assert.equal(requests[1]!.options.query?.accountCode, 'BA1')
  assert.equal(requests[2]!.url, '/finance/api/v1/bank-accounts/BA%2F1')
  assert.deepEqual(requests[2], requests[3])
  assert.deepEqual(requests[2]!.options.body, { status: 'inactive', expectedVersion: 3 })
  assert.equal(requests[2]!.options.headers?.['Idempotency-Key'], 'same-intent')
  assert.ok(requests.every(request => request.options.retry === 0))
})

test('Finance amounts remain fixed-point strings and effective ranges use valid calendar dates', () => {
  assert.equal(decimalInput('9999999999999999.99', 2), '9999999999999999.99')
  assert.equal(decimalInput('002.1', 2), '2.10')
  assert.equal(decimalInput('0.2', 4), '0.2000')
  for (const invalid of ['-1', '1e3', 'NaN', '1.001']) assert.throws(() => decimalInput(invalid, 2))
  assert.equal(formatMoney('9999999999999999.99', { currency: 'CNY' }), '¥9,999,999,999,999,999.99')
  assert.equal(validEffectiveRange('2026-02-30', null), false)
  assert.equal(validEffectiveRange('2026-10-02', '2026-10-01'), false)
  assert.equal(validEffectiveRange('2026-10-01', null), true)
})

test('failed writes retain the same intent while changed drafts or versions use a new key', () => {
  let sequence = 0
  const intent = createFinanceIntent(() => `key-${++sequence}`)
  assert.equal(intent.key({ expectedVersion: 1, name: '账户' }), 'key-1')
  assert.equal(intent.key({ expectedVersion: 1, name: '账户' }), 'key-1')
  assert.equal(intent.key({ expectedVersion: 2, name: '账户' }), 'key-2')
  intent.reset()
  assert.equal(intent.key({ expectedVersion: 2, name: '账户' }), 'key-3')
  assert.match(financeWriteMessage({ statusCode: 409 }), /刷新比较.*草稿已保留/)
  assert.match(financeWriteMessage(new Error('fetch failed /internal/secret')), /保存结果未确认/)
  assert.doesNotMatch(financeWriteMessage(new Error('fetch failed /internal/secret')), /fetch|internal/)
})

test('all Finance Host pages and components compile as complete SFCs', () => {
  for (const directory of ['layer/pages', 'app/components/host']) {
    for (const name of readdirSync(new URL(`../${directory}/`, import.meta.url)).filter(name => name.endsWith('.vue'))) {
      const filename = `${directory}/${name}`
      const source = readFileSync(new URL(`../${filename}`, import.meta.url), 'utf8')
      const parsed = parse(source, { filename })
      assert.deepEqual(parsed.errors, [], filename)
      const script = compileScript(parsed.descriptor, { id: filename })
      const compiled = compileTemplate({ source: parsed.descriptor.template!.content, filename, id: filename, compilerOptions: { bindingMetadata: script.bindings } })
      assert.deepEqual(compiled.errors, [], filename)
    }
  }
  const list = readFileSync(new URL('../app/components/host/FinanceListPage.vue', import.meta.url), 'utf8')
  assert.match(list, /:key="version\.row_version"/)
  for (const pattern of [/CommonEmptyState/, /:loading=/, /UPagination/, /共/, /sm:hidden/, /已登记快照，非实时余额/, /useConfirm/]) assert.match(list, pattern)
  const editor = readFileSync(new URL('../app/components/host/BankAccountEditor.vue', import.meta.url), 'utf8')
  assert.equal((editor.match(/<UFormField/g) || []).length, 12)
  assert.match(editor, /更多账户资料/)
  assert.match(editor, /expectedVersion/)
  assert.match(editor, /finally/)
  assert.match(editor, /comparison/)
})

test('paging and scope changes ignore stale financial data', async () => {
  const { default: ts } = await import('typescript')
  const { runInNewContext } = await import('node:vm')
  const vue = await import('vue')
  const scope = vue.ref('user-a')
  const source = readFileSync(new URL('../app/composables/useFinancePagedList.ts', import.meta.url), 'utf8')
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
  const exports: Record<string, (...args: any[]) => any> = {}
  runInNewContext(output, {
    exports, ...vue, onScopeDispose: () => {}, useState: () => scope,
    useDebouncedSearch: ({ onChange }: { onChange: () => void }) => {
      const search = vue.ref('')
      const debounced = vue.ref('')
      return { search, debounced, flush: () => {
        debounced.value = search.value
        onChange()
      } }
    }
  })
  const requests: { query: { page: number, search?: string }, resolve: (value: unknown) => void, reject: (error: unknown) => void }[] = []
  const allowed = vue.ref(true)
  const list = exports.useFinancePagedList!((query: { page: number }) => new Promise((resolve, reject) => requests.push({ query, resolve, reject })), allowed)
  list.page.value = 2
  await vue.nextTick()
  assert.equal(requests.length, 2)
  requests[0]!.resolve({ data: ['old'], total: 1, page: 1, pageSize: 20 })
  requests[1]!.resolve({ data: ['current'], total: 21, page: 2, pageSize: 20 })
  await vue.nextTick()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(Array.from(list.items.value), ['current'])
  list.search.value = 'abc'
  await vue.nextTick()
  assert.equal(requests.length, 2)
  list.flush()
  await vue.nextTick()
  assert.equal(requests.length, 3)
  assert.equal(requests[2]!.query.page, 1)
  assert.equal(requests[2]!.query.search, 'abc')
  scope.value = 'user-b'
  await vue.nextTick()
  assert.equal(requests.length, 4)
  assert.equal(list.items.value.length, 0)
  requests[2]!.resolve({ data: ['foreign'], total: 1, page: 1, pageSize: 20 })
  requests[3]!.reject(new Error('offline'))
  await vue.nextTick()
  assert.equal(list.items.value.length, 0)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(list.pending.value, false)
  assert.match(list.error.value, /暂不可用/)
  allowed.value = false
  await vue.nextTick()
  assert.equal(list.total.value, 0)
  assert.equal(requests.length, 4)
})

test('account editor keeps drafts and loading resets on failed save; retry uses identical version and key', async () => {
  const { default: ts } = await import('typescript')
  const { runInNewContext } = await import('node:vm')
  const vue = await import('vue')
  const source = parse(readFileSync(new URL('../app/components/host/BankAccountEditor.vue', import.meta.url), 'utf8')).descriptor.scriptSetup!.content.replace(/^import .*$/gm, '')
  const output = ts.transpileModule(`${source}\nreturn { form, open, pending, error, submit, expectedVersion, comparison, adoptVersion }`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  const requests: FinanceFetchOptions[] = []
  const notices: { title: string }[] = []
  const account = { code: 'BA1', account_name: '旧账户', account_type: 'bank', currency_code: 'CNY', row_version: 3 }
  const editor = runInNewContext(`(async () => { ${output} })()`, {
    ...vue, defineProps: () => ({ account, canEdit: true }), defineModel: () => vue.ref(false), defineEmits: () => () => {},
    useFinanceModule: () => ({ apiUrl: (path: string) => `/finance/api/v1${path}` }),
    financeDateRange, financeListRouteQuery, createHostFinanceClient, createFinanceIntent, financeWriteMessage, accountW3Patch, useToast: () => ({ add: (notice: { title: string }) => notices.push(notice) }),
    $fetch: async (_url: string, options: FinanceFetchOptions) => {
      requests.push(options)
      if (requests.length < 3) throw { statusCode: 409 }
      return { data: account }
    }
  })
  const state = await editor
  state.open.value = true
  await vue.nextTick()
  state.form.accountName = '我的草稿'
  await state.submit()
  assert.equal(state.pending.value, false)
  assert.equal(state.open.value, true)
  assert.equal(state.form.accountName, '我的草稿')
  assert.match(state.error.value, /刷新比较/)
  await state.submit()
  assert.deepEqual(requests[0], requests[1])
  assert.equal((requests[0]!.body as { expectedVersion: number }).expectedVersion, 3)
  assert.equal('accountNoSecretRef' in (requests[0]!.body as object), false)
  state.comparison.value = { ...account, account_name: '他人改名', row_version: 4 }
  state.adoptVersion()
  assert.equal(state.form.accountName, '我的草稿')
  await state.submit()
  assert.equal((requests[2]!.body as { expectedVersion: number }).expectedVersion, 4)
  assert.notEqual(requests[0]!.headers?.['Idempotency-Key'], requests[2]!.headers?.['Idempotency-Key'])
  assert.equal(state.open.value, false)
  assert.equal(notices.at(-1)!.title, '账户已更新')
  state.open.value = true
  await vue.nextTick()
  state.form.accountNoMasked = '****12345678'
  await state.submit()
  assert.equal(requests.length, 3, 'continuous eight-digit account number is rejected locally')
  assert.match(state.error.value, /连续八位/)
  state.form.accountNoMasked = '尾号1234'
  await state.submit()
  assert.equal((requests[3]!.body as { accountNoMasked: string }).accountNoMasked, '尾号1234')
})

test('parameter conflict comparison preserves decimal drafts and advances only the expected version', async () => {
  const { default: ts } = await import('typescript')
  const { runInNewContext } = await import('node:vm')
  const vue = await import('vue')
  const source = parse(readFileSync(new URL('../app/components/host/PeopleCostParameterForm.vue', import.meta.url), 'utf8')).descriptor.scriptSetup!.content.replace(/^import .*$/gm, '')
  const output = ts.transpileModule(`${source}\nreturn { form, saving, saveError, submit, original, comparison, useLatestVersion }`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  const row = { code: 'PC1', name: '标准', effective_from: '2026-10-01', effective_to: null, base_salary: '9007199254740993.01', welfare_cost_rate: '0.1000', management_allocation_rate: '0.2000', resource_allocation_cost: '20.00', currency_code: 'CNY', status: 'active', remark: null, row_version: 2 }
  const writes: FinanceFetchOptions[] = []
  const state = await runInNewContext(`(async () => { ${output} })()`, {
    ...vue, onScopeDispose: () => {}, useRoute: () => ({ params: { code: 'PC1' } }), useRouter: () => ({ push: async () => {} }),
    useFinanceModule: () => ({ apiUrl: (path: string) => path, moduleUrl: (path: string) => path, hosted: true, sessionScope: null }),
    usePermissions: () => ({ error: vue.ref(null), loadPermissions: async () => {}, loaded: vue.ref(true), hasPermission: () => true }),
    useToast: () => ({ add: () => {} }), useConfirm: () => ({ confirm: async () => true }),
    financeDateRange, financeListRouteQuery, createHostFinanceClient, createFinanceIntent, financeWriteMessage, decimalInput, validEffectiveRange,
    $fetch: async (_url: string, options: FinanceFetchOptions) => {
      if (!options.method) return { data: row }
      writes.push(options)
      throw { statusCode: 409 }
    }
  })
  await new Promise(resolve => setImmediate(resolve))
  state.form.name = '我的草稿'
  await state.submit()
  assert.equal(state.saving.value, false)
  assert.equal(state.form.name, '我的草稿')
  assert.match(state.saveError.value, /草稿已保留/)
  assert.equal((writes[0]!.body as { baseSalary: string }).baseSalary, row.base_salary)
  await state.submit()
  assert.deepEqual(writes[0], writes[1])
  state.comparison.value = { ...row, name: '其他人改名', row_version: 3 }
  state.useLatestVersion()
  assert.equal(state.form.name, '我的草稿')
  await state.submit()
  assert.equal((writes[2]!.body as { expectedVersion: number }).expectedVersion, 3)
  assert.notEqual(writes[0]!.headers?.['Idempotency-Key'], writes[2]!.headers?.['Idempotency-Key'])
})

test('WP3 transport strips unsupported snapshot and history filters', async () => {
  const requests: FinanceFetchOptions[] = []
  const api = createHostFinanceClient(async <T>(_url: string, options: FinanceFetchOptions) => {
    requests.push(options)
    return {} as T
  }, path => path)
  const query = { page: 2, pageSize: 20, search: '账户', status: 'active', accountCode: 'BA-1', startDate: '2026-10-01', endDate: '2026-10-31' }
  await api.snapshots(query)
  await api.parameterHistory('PCP-1', query)
  await api.accounts(query)
  assert.deepEqual(requests[0]!.query, { page: 2, pageSize: 20, search: '账户', accountCode: 'BA-1', startDate: '2026-10-01', endDate: '2026-10-31' })
  assert.deepEqual(requests[1]!.query, { page: 2, pageSize: 20 })
  assert.deepEqual(requests[2]!.query, { page: 2, pageSize: 20, search: '账户', status: 'active' })
})

test('WP3 distinguishes overlap and concurrency from version conflicts without losing drafts', () => {
  assert.match(financeWriteMessage({ statusCode: 409, data: { code: 'finance_effective_range_overlap' } }), /区间.*重叠.*草稿已保留/)
  assert.match(financeWriteMessage({ statusCode: 409, data: { code: 'finance_write_conflict' } }), /重试同一请求.*草稿已保留/)
  assert.match(financeWriteMessage({ statusCode: 409, data: { code: 'finance_idempotency_conflict' } }), /请求已变更.*草稿已保留/)
})

test('WP3 actual page permission conditions require admin for writes and all parameter access', async () => {
  const { default: ts } = await import('typescript')
  const { runInNewContext } = await import('node:vm')
  const vue = await import('vue')
  for (const [file, kind, grants, expected] of [
    ['FinanceListPage.vue', 'accounts', ['bank_accounts:view', 'bank_accounts:edit'], [true, false]],
    ['FinanceListPage.vue', 'accounts', ['bank_accounts:view', 'bank_accounts:admin'], [true, true]],
    ['FinanceListPage.vue', 'snapshots', ['bank_accounts:view'], [true, false]],
    ['FinanceListPage.vue', 'parameters', ['settings:view', 'settings:edit'], [false, false]],
    ['FinanceListPage.vue', 'parameters', ['settings:admin'], [true, true]],
    ['BankAccountDetails.vue', 'accounts', ['bank_accounts:view', 'bank_accounts:edit'], [true, false]],
    ['PeopleCostParameterForm.vue', 'parameters', ['settings:view', 'settings:edit'], [false, false]],
    ['PeopleCostParameterForm.vue', 'parameters', ['settings:admin'], [true, true]]
  ] as const) {
    const source = parse(readFileSync(new URL(`../app/components/host/${file}`, import.meta.url), 'utf8')).descriptor.scriptSetup!.content.replace(/^import .*$/gm, '')
    const output = ts.transpileModule(`${source}\nreturn { canView, canEdit }`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
    const state = runInNewContext(`(() => { ${output} })()`, {
      ...vue, watch: () => {}, onScopeDispose: () => {}, defineProps: () => ({ kind }),
      useRoute: () => ({ query: {}, params: {} }), useRouter: () => ({}),
      useFinanceModule: () => ({ hosted: true, apiUrl: (path: string) => path, moduleUrl: (path: string) => path, sessionScope: null }),
      usePermissions: () => ({ error: vue.ref(null), loadPermissions: async () => {}, loaded: vue.ref(true), hasPermission: (resource: string, action: string) => (grants as readonly string[]).includes(`${resource}:${action}`) }),
      useFinancePagedList: () => ({ page: vue.ref(1), items: vue.ref([]), total: vue.ref(0) }),
      useToast: () => ({ add: () => {} }), useConfirm: () => ({ confirm: async () => true }),
      financeDateRange, financeListRouteQuery, createHostFinanceClient, createFinanceIntent, financeWriteMessage, decimalInput, validEffectiveRange, $fetch: () => { throw new Error('Unexpected request') }
    })
    assert.deepEqual([state.canView.value, state.canEdit.value], [...expected], `${file}/${kind}/${grants.join(',')}`)
  }
})

test('Finance Host pages load permissions on mount before loaded guards, and can retry failures', async () => {
  const { default: ts } = await import('typescript')
  const { runInNewContext } = await import('node:vm')
  const vue = await import('vue')
  for (const file of ['FinanceListPage.vue', 'BankAccountDetails.vue', 'PeopleCostParameterForm.vue']) {
    const descriptor = parse(readFileSync(new URL(`../app/components/host/${file}`, import.meta.url), 'utf8')).descriptor
    const source = descriptor.scriptSetup!.content.replace(/^import .*$/gm, '')
    const output = ts.transpileModule(`${source}\nreturn { canView, canEdit, loaded, permissionError, loadPermissions }`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
    const loaded = vue.ref(false)
    const permissionError = vue.ref<Error | null>(null)
    let fail = false
    let grant = true
    const requests: string[] = []
    const mounted: (() => void)[] = []
    const state = runInNewContext(`(() => { ${output} })()`, {
      ...vue, watch: () => {}, onScopeDispose: () => {}, onMounted: (callback: () => void) => mounted.push(callback),
      defineProps: () => ({ kind: 'accounts' }),
      useRoute: () => ({ query: {}, params: {} }), useRouter: () => ({}),
      useFinanceModule: () => ({ hosted: true, apiUrl: (path: string) => path, moduleUrl: (path: string) => path, sessionScope: null }),
      usePermissions: () => ({ loaded, error: permissionError, hasPermission: (resource: string, action: string) => authorizationResourcesAllow(grant ? { bank_accounts: ['admin'], settings: ['admin'] } : {}, resource, action),
        loadPermissions: async () => {
          requests.push('/enterprise/api/auth/permissions?app=finance')
          permissionError.value = fail ? new Error('dependency unavailable') : null
          loaded.value = true
        }
      }),
      useFinancePagedList: () => ({ page: vue.ref(1), items: vue.ref([]), total: vue.ref(0) }),
      useToast: () => ({ add: () => {} }), useConfirm: () => ({ confirm: async () => true }),
      financeDateRange, financeListRouteQuery, createHostFinanceClient, createFinanceIntent, financeWriteMessage, decimalInput, validEffectiveRange, $fetch: () => { throw new Error('Unexpected request') }
    })
    assert.equal(state.canView.value, false)
    assert.equal(requests.length, 0)
    assert.equal(mounted.length, 1, file)
    mounted[0]!()
    await vue.nextTick()
    assert.deepEqual(requests, ['/enterprise/api/auth/permissions?app=finance'])
    assert.equal(state.canView.value, true)
    assert.equal(state.canEdit.value, true)
    fail = true
    await state.loadPermissions({ force: true })
    assert.ok(state.permissionError.value)
    assert.equal(state.canView.value, false)
    assert.equal(state.canEdit.value, false)
    fail = false
    grant = false
    await state.loadPermissions({ force: true })
    assert.equal(state.permissionError.value, null)
    assert.equal(state.canView.value, false)
    const template = descriptor.template!.content
    // Failure/loading/denial must precede the data result branch, so neither
    // unresolved permissions nor outages render the table's empty data state.
    const failure = template.indexOf('v-if="permissionError"')
    const loading = template.indexOf('v-else-if="!loaded"')
    const denied = template.indexOf('v-else-if="!canView"')
    assert.ok(failure >= 0 && loading > failure && denied > loading, file)
    assert.match(template, /权限加载失败/)
    assert.match(template, /正在加载财务权限/)
    assert.match(template, /loadPermissions\(\{ force: true \}\)/)
  }
})
