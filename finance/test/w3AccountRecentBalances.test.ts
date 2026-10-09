import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { parse, compileScript } from '@vue/compiler-sfc'
import { ref, reactive, computed, watch, onScopeDispose, effectScope, nextTick } from 'vue'
import { createHostFinanceClient } from '../app/utils/hostFinanceClient.ts'
import { financeDateRange } from '../app/utils/financeWorkbench.ts'
import { w3AccountTypeLabel } from '../app/utils/w3AccountPresentation.ts'

function harness(fetcher: (url: string, options: Record<string, unknown>) => Promise<unknown>) {
  const pageSource = parse(readFileSync(new URL('../app/components/host/BankAccountDetails.vue', import.meta.url), 'utf8')).descriptor.scriptSetup!.content
  const listSource = readFileSync(new URL('../app/composables/useFinancePagedList.ts', import.meta.url), 'utf8')
  const strip = (text: string) => {
    const program = ts.createSourceFile('component.ts', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    return program.statements.filter(node => !ts.isImportDeclaration(node)).map(node => node.getText(program)).join('\n').replace('export function', 'function')
  }
  const code = ts.transpileModule(strip(listSource) + '\n' + strip(pageSource) + '\nreturn { balances, tab, canView, account, refresh }', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  const cache = ref('synthetic-session'), grant = ref(true), route = reactive({ params: { code: 'BA-SYNTHETIC' } })
  const context = { financeDateRange, createHostFinanceClient, w3AccountTypeLabel, ref, reactive, computed, watch, onScopeDispose, useState: () => cache, useRoute: () => route, onMounted: () => {}, useFinanceModule: () => ({ apiUrl: (path: string) => '/finance/api/v1' + path, moduleUrl: (path: string) => '/finance' + path, hosted: true, sessionScope: cache }), usePermissions: () => ({ loaded: ref(true), error: ref(null), hasPermission: () => grant.value, loadPermissions: async () => {} }), useDebouncedSearch: () => ({ search: ref(''), debounced: ref(''), flush: () => {} }), $fetch: fetcher }
  const scope = effectScope()
  const state = scope.run(() => new Function(...Object.keys(context), code)(...Object.values(context)))
  return { ...state, route, grant, cache, stop: () => scope.stop() }
}
test('account detail reads the last thirty business days through the existing scoped paginated snapshot contract', async () => {
  const calls: { url: string, query?: Record<string, unknown> }[] = []
  const h = harness(async (url, options) => {
    calls.push({ url, query: options.query as Record<string, unknown> })
    return url.endsWith('/balances') ? { data: [], total: 0, page: (options.query as Record<string, unknown>).page, pageSize: 20 } : { data: { code: 'BA-SYNTHETIC', account_name: '合成账户' } }
  })
  try {
    await nextTick()
    await nextTick()
    assert.equal(calls.filter(call => call.url.endsWith('/balances')).length, 0, 'basic tab must not eagerly fetch balances')
    h.tab.value = 'balances'
    await nextTick()
    await nextTick()
    const query = calls.find(call => call.url.endsWith('/balances'))!.query!
    assert.equal(query.accountCode, 'BA-SYNTHETIC')
    assert.equal(query.page, 1)
    assert.equal(query.pageSize, 20)
    assert.equal((Date.parse(String(query.endDate)) - Date.parse(String(query.startDate))) / 86400000, 29)
    h.balances.page.value = 2
    await nextTick()
    assert.equal(calls.at(-1)!.query!.page, 2)
    h.route.params.code = 'BA-SYNTHETIC-NEW'
    await nextTick()
    await nextTick()
    const current = calls.filter(call => call.url.endsWith('/balances')).at(-1)!.query!
    assert.equal(current.accountCode, 'BA-SYNTHETIC-NEW')
    assert.equal(current.page, 1)
    const before = calls.length
    h.grant.value = false
    await nextTick()
    assert.equal(calls.length, before)
    assert.deepEqual(h.balances.items.value, [])
  } finally { h.stop() }
})
test('balance detail supports narrow cards, loading/empty state, original day flow and absence distinct from zero', () => {
  for (const file of ['BankAccountDetails.vue', 'FinanceListPage.vue']) {
    const source = readFileSync(new URL(`../app/components/host/${file}`, import.meta.url), 'utf8')
    const { descriptor, errors } = parse(source, { filename: file })
    assert.deepEqual(errors, [])
    assert.doesNotThrow(() => compileScript(descriptor, { id: file, inlineTemplate: true }))
    assert.match(source, /sm:hidden/)
    assert.match(source, /共 .* 条/)
    if (file.startsWith('BankAccountDetails')) {
      assert.match(source, /所选日期范围无余额记录/)
      assert.match(source, /register\?\.showEntries\(snapshot\)/)
      assert.match(source, /:loading="balances.pending.value"/)
    } else assert.match(source, /row.original.amount === null \? '无余额记录'/)
  }
})

test('account filters and bounded-complete intent pass only on their owning read and snapshots include entity scope', async () => {
  const calls: { url: string, query: unknown }[] = []
  const api = createHostFinanceClient(async <T>(url: string, options: { query?: unknown }) => {
    calls.push({ url, query: options.query })
    return {} as T
  }, path => path)
  await api.accounts({ page: 1, pageSize: 20, legalEntityCode: 'LE-SYNTHETIC', accountType: 'bank', complete: true })
  assert.deepEqual(calls[0]!.query, { page: 1, pageSize: 20, legalEntityCode: 'LE-SYNTHETIC', accountType: 'bank', complete: true })
  await api.snapshots({ page: 2, pageSize: 20, legalEntityCode: 'LE-SYNTHETIC' })
  assert.deepEqual(calls[1]!.query, { page: 2, pageSize: 20, legalEntityCode: 'LE-SYNTHETIC' })
  await api.parameters({ page: 1, pageSize: 20, legalEntityCode: 'LE-SYNTHETIC', complete: true })
  assert.deepEqual(calls[2]!.query, { page: 1, pageSize: 20 }, 'new account filters never reach parameter reads')
})
test('balance evidence SFC has read-only paginated controls and explicit Foundation empty states', () => {
  const source = readFileSync(new URL('../app/components/host/W3BalanceEvidence.vue', import.meta.url), 'utf8')
  const { descriptor, errors } = parse(source)
  assert.deepEqual(errors, [])
  assert.doesNotThrow(() => compileScript(descriptor, { id: 'evidence', inlineTemplate: true }))
  assert.match(source, /exceptionId: String\(props.row.id\)/)
  assert.match(source, /pageSize: 20/)
  assert.match(source, /:loading="pending"/)
  assert.match(source, /:items-per-page="20"/)
  assert.match(source, /sm:hidden/)
  assert.doesNotMatch(source, /row_json|method: 'POST'/)
})
