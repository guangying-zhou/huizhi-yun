import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import { apfChoiceOptions, apfChoicePage, apfObjectSpecs } from '../app/utils/apfObjectChoices.ts'
import { financeChoicePage, financeChoiceError, financeObjectOptions } from '../../finance/app/utils/hostFinanceObjectChoices.ts'

const read = file => readFileSync(new URL(file, import.meta.url), 'utf8')
const configs = [
  { file: '../app/components/AltocBusinessObjectSelect.vue', fn: 'load', epoch: 'epoch', rows: 'options', prefix: '' },
  { file: '../../finance/app/components/host/FinanceBusinessObjectSelect.vue', fn: 'load', epoch: 'epoch', rows: 'options', prefix: '' },
  { file: '../../finance/app/components/host/W3QueueObjectSelect.vue', fn: 'load', epoch: 'generation', rows: 'items', prefix: '' },
  { file: '../app/components/AltocQuotationsPage.vue', fn: 'loadCustomers', epoch: 'customerEpoch', rows: 'customerRows', prefix: 'customer' },
  { file: '../app/components/W3CustomerActions.vue', fn: 'loadContactChoices', epoch: 'contactGeneration', rows: 'contactRows', prefix: 'contact' },
  { file: '../../assets/app/components/assets/RemoteAssetObjectSelect.vue', fn: 'load', epoch: 'epoch', rows: 'options', prefix: '' }
]
function harness(config) {
  const ast = ts.createSourceFile('select.ts', parse(read(config.file)).descriptor.scriptSetup.content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const fn = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === config.fn)
  const code = ts.transpileModule(`let ${config.epoch}=0;\n${fn.getText(ast)}\nexport { ${config.fn} as load }`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const options = { value: [] }, page = { value: 1 }, hasMore = { value: false }, error = { value: '' }, loading = { value: false }, search = { value: '' }, scope = { value: 'fixture' }
  const calls = []
  const state = { exports: {}, props: { kind: 'customers', enabled: true, excludeIds: [], customer: { id: 1 } }, options, items: options, customerRows: options, contactRows: options, contactPage: page, contactHasMore: hasMore, contactsPending: loading, contactsError: error, contactSearchDebounced: search, mode: { value: 'primary' }, page, customerPage: page, hasMore, customerHasMore: hasMore, loading, customerLoading: loading, error, customerError: error, debounced: search, customerDebounced: search, scope, scopeKey: scope, sessionScope: scope, allowed: { value: true }, open: { value: true }, canEdit: { value: true }, accessStatus: { value: 'ready' }, paged: { value: true }, spec: { value: apfObjectSpecs.customers }, moduleUrl: x => x, apiUrl: x => x, apfChoiceOptions, apfChoicePage, financeChoicePage, financeChoiceError, financeObjectOptions,
    $fetch: (url, options) => new Promise((resolve, reject) => calls.push({ url, options, resolve, reject })) }
  runInNewContext(code, state)
  return { state, calls, options, page, hasMore, loading, error, search, scope, load: state.exports.load }
}
function result(ids, total = 758) {
  return { code: 0, data: { items: ids.map(id => ({ id, code: `CU-${id}`, name: `合成客户${id}` })), total } }
}
for (const config of configs) {
  test(`${config.file}: search resets to page1; scroll/retry append preserves choices and rejects stale replies`, async () => {
    const h = harness(config)
    const first = h.load()
    assert.equal(h.calls[0].options.query.page, 1)
    assert.ok(!Object.hasOwn(h.calls[0].options.query, 'search'), 'omit empty query')
    h.calls[0].resolve(result(Array.from({ length: 20 }, (_, i) => i + 1)))
    await first
    assert.equal(h.options.value.length, 20)
    const append = h.load(true)
    await h.load(true)
    assert.equal(h.calls.length, 2, 'scroll cannot submit duplicate requests')
    h.calls[1].reject({ statusCode: 503 })
    await append
    assert.equal(h.options.value.length, 20)
    assert.equal(h.page.value, 1)
    assert.equal(h.loading.value, false)
    assert.ok(h.error.value)
    const retry = h.load(true)
    assert.equal(h.calls[2].options.query.page, 2)
    h.calls[2].resolve(result([20, 21, 22]))
    await retry
    assert.equal(h.options.value.length, 22, 'duplicate row not appended')
    const old = h.load(true)
    h.search.value = '新搜索'
    const newer = h.load()
    assert.equal(h.calls[4].options.query.page, 1)
    assert.equal(h.calls[4].options.query.search, '新搜索')
    h.calls[4].resolve(result([99], 1))
    await newer
    h.calls[3].resolve(result([23, 24]))
    await old
    assert.equal(h.options.value.length, 1)
    assert.equal(h.hasMore.value, false)
    assert.equal(h.page.value, 1)
    const full = h.load()
    h.calls[5].resolve(result(Array.from({ length: 30 }, (_, i) => i + 1), 30))
    await full
    assert.equal(h.hasMore.value, false, 'full-list legacy response never creates fake subsequent pages')
    h.scope.value = ''
    await h.load()
    assert.equal(h.calls.length, 6, 'empty identity must not read')
    assert.equal(h.options.value.length, 0)
  })
}

test('receivable popup uses the same currency dropdown and full-width employee trigger', () => {
  const text = read('../app/components/AltocReceivablesPage.vue')
  assert.match(text, /<UFormField label="币种">\s*<USelect\s+v-model="currencySelection"/)
  assert.equal(text.match(/:items="currencyOptions"/g).length, 2, 'toolbar and popup reuse the same currency choices')
  assert.match(text, /v-model="collectors"[\s\S]*?width-class="w-full"/)
  for (const config of configs) {
    const { descriptor, errors } = parse(read(config.file))
    assert.deepEqual(errors, [])
    const script = compileScript(descriptor, { id: config.file })
    assert.deepEqual(compileTemplate({ source: descriptor.template.content, filename: config.file, id: config.file, compilerOptions: { bindingMetadata: script.bindings } }).errors, [])
  }
})

test('array list totals drive actual remote paging, contacts stay a local scoped list', () => {
  assert.equal(apfChoicePage({ data: [{ id: 1 }], total: 758 }, 'customers').total, 758)
  assert.equal(apfChoicePage({ data: { contacts: [{ id: 1 }] }, total: 758 }, 'contacts').total, 1)
  assert.throws(() => apfChoicePage({ data: [{ id: 1 }], total: -1 }, 'customers'))
  assert.throws(() => apfChoicePage({ data: [{ id: 1 }], total: 1.5 }, 'customers'))
})
