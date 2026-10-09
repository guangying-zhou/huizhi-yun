import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import { financeBankAccountChoice, financeBankAccountLabel, financeObjectOptions, financeChoicePage, financeChoiceError } from '../app/utils/hostFinanceObjectChoices.ts'

const source = readFileSync(new URL('../app/components/host/FinanceBusinessObjectSelect.vue', import.meta.url), 'utf8')
const bank = (id: number) => ({ id, code: `BA-${id}`, name: '主体名称', short_name: `汇智建行基本户${id}`, account_name: '汇智企业有限公司', bank_name: '中国建设银行', currency_code: 'CNY', account_no_masked: `****${String(id).padStart(4, '0')}`, status: 'active' })
function harness() {
  const ast = ts.createSourceFile('selector.ts', parse(source).descriptor.scriptSetup!.content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const fn = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'load')!
  const code = ts.transpileModule('let epoch = 0;\n' + fn.getText(ast) + '\nexport { load }', { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const calls: { query: { page: number, pageSize: number, search?: string }, resolve: (value: unknown) => void, reject: (value: unknown) => void }[] = []
  const state = {
    exports: {} as { load: (append?: boolean) => Promise<void> }, props: { kind: 'bank-accounts', enabled: true, accountValue: 'code', activeOnly: false },
    options: { value: [] as ReturnType<typeof financeObjectOptions> }, total: { value: 0 }, hasMore: { value: false }, page: { value: 1 }, loading: { value: false }, error: { value: '' },
    sessionScope: { value: 'synthetic' }, debounced: { value: '汇智建行' }, apiUrl: (path: string) => path,
    financeObjectOptions, financeChoicePage, financeChoiceError,
    $fetch: (_url: string, opts: { query: { page: number, pageSize: number, search?: string } }) => new Promise((resolve, reject) => calls.push({ query: opts.query, resolve, reject }))
  }
  runInNewContext(code, state)
  return { ...state, calls, load: state.exports.load }
}
test('all account choices prefer short name and show only masked bank/currency/tail metadata', () => {
  const row = { ...bank(1), account_no: 'SECRET_FULL_ACCOUNT', account_no_secret_ref: 'SECRET_REF' }
  assert.deepEqual(financeBankAccountChoice(row), { label: '汇智建行基本户1', description: '中国建设银行 · CNY · 尾号0001 · BA-1' })
  assert.doesNotMatch(JSON.stringify(financeBankAccountChoice(row)), /SECRET|主体名称|汇智企业有限公司/)
  assert.equal(financeObjectOptions([row], 'bank-accounts')[0]!.value, '1')
  assert.equal(financeObjectOptions([row], 'bank-accounts', 'code')[0]!.value, 'BA-1')
  assert.match(financeBankAccountLabel(row), /^汇智建行基本户1（中国建设银行/)
  assert.equal(financeBankAccountChoice({ code: 'BA-FALLBACK', account_name: '开户名称' }).label, '开户名称')
  assert.equal(financeBankAccountChoice({ code: 'BA-FALLBACK', account_no: '1234567890' }).description, 'BA-FALLBACK', 'raw account numbers are never consumed')
})
test('22 accounts load as one initial page and one append, no duplicate scroll request; failed append preserves options and retries page2', async () => {
  const h = harness()
  const first = h.load()
  assert.equal(h.calls[0]!.query.page, 1)
  assert.equal(h.calls[0]!.query.search, '汇智建行')
  h.calls[0]!.resolve({ data: Array.from({ length: 20 }, (_, index) => bank(index + 1)), total: 22 })
  await first
  const append = h.load(true)
  await h.load(true)
  assert.equal(h.calls.length, 2)
  h.calls[1]!.reject({ statusCode: 503 })
  await append
  assert.equal(h.options.value.length, 20)
  assert.equal(h.page.value, 1)
  assert.equal(h.loading.value, false)
  assert.match(h.error.value, /加载失败/)
  const retry = h.load(true)
  assert.equal(h.calls[2]!.query.page, 2)
  h.calls[2]!.resolve({ data: [bank(21), bank(22)], total: 22 })
  await retry
  assert.equal(h.options.value.length, 22)
  assert.equal(h.hasMore.value, false)
  await h.load(true)
  assert.equal(h.calls.length, 3)
})
test('remote short-name search resets to page1 and rejects old appended results; disabled access stops reading', async () => {
  const h = harness()
  const first = h.load()
  h.calls[0]!.resolve({ data: Array.from({ length: 20 }, (_, index) => bank(index + 1)), total: 22 })
  await first
  const append = h.load(true)
  h.debounced.value = '新简称'
  const search = h.load()
  assert.equal(h.calls[2]!.query.page, 1)
  assert.equal(h.calls[2]!.query.search, '新简称')
  h.calls[2]!.resolve({ data: [bank(99)], total: 1 })
  await search
  h.calls[1]!.resolve({ data: [bank(21), bank(22)], total: 22 })
  await append
  assert.equal(h.options.value.length, 1)
  assert.equal(h.options.value[0]!.value, 'BA-99')
  h.props.enabled = false
  await h.load()
  assert.equal(h.calls.length, 3)
  assert.equal(h.options.value.length, 0)
  assert.equal(h.hasMore.value, false)
})
test('account selector pagination lives only inside the dropdown; migration shares account presentation and toolbar fields align', () => {
  for (const file of ['FinanceBusinessObjectSelect.vue', 'W3QueueObjectSelect.vue', 'FinanceListPage.vue']) {
    const text = readFileSync(new URL(`../app/components/host/${file}`, import.meta.url), 'utf8')
    const { descriptor, errors } = parse(text, { filename: file })
    assert.deepEqual(errors, [])
    const script = compileScript(descriptor, { id: file })
    assert.deepEqual(compileTemplate({ source: descriptor.template!.content, filename: file, id: file, compilerOptions: { bindingMetadata: script.bindings } }).errors, [])
  }
  assert.doesNotMatch(source, /UPagination|共 {{ total }}/)
  assert.match(source, /import RemoteObjectSelectMenu/)
  assert.match(source, /@load-more="load\(true\)"/)
  const queue = readFileSync(new URL('../app/components/host/W3QueueObjectSelect.vue', import.meta.url), 'utf8')
  assert.match(queue, /<FinanceBusinessObjectSelect[\s\S]*account-value="code"/)
  assert.match(queue, /if \(props.kind === 'bank-accounts'/)
})
