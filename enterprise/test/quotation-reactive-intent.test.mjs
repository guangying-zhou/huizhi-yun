import test from 'node:test'
import assert from 'node:assert/strict'
import { reactive } from 'vue'
import { quotationItemsPayload } from '../app/utils/altocHostForms.ts'
import { createConsoleMutationIntent } from '../../foundation/shared/utils/consoleMutationIntent.ts'

test('reactive quotation lines snapshot before fetch; separate intents and lost response reuse keys', async () => {
  const lines = reactive([{ item_name: '服务', specification: '', unit: '项', quantity: '1', unit_price: '20.00', discount_rate: '0', tax_rate: '6' }])
  assert.throws(() => structuredClone({ items: lines }), { name: 'DataCloneError' })
  const intent = createConsoleMutationIntent('quote', (() => {
    let n = 0
    return () => `key-${++n}`
  })())
  const calls = []
  const send = async (request, key) => {
    calls.push({ request, key })
  }
  await intent.submit({ method: 'POST', path: '/quotes', body: { customerId: '1' } }, send)
  const body = quotationItemsPayload(2, lines)
  let failed = true
  const retry = async (request, key) => {
    await send(request, key)
    if (failed) throw Object.assign(Error('lost'), { statusCode: 503 })
  }
  await assert.rejects(intent.submit({ method: 'PATCH', path: '/quotes/1/items', body }, retry))
  assert.equal(calls.length, 2)
  assert.notEqual(calls[0].key, calls[1].key)
  failed = false
  await intent.submit({ method: 'PATCH', path: '/quotes/1/items', body: quotationItemsPayload(2, lines) }, retry)
  assert.equal(calls[2].key, calls[1].key)
  lines[0].item_name = '新内容'
  assert.equal(calls[1].request.body.items[0].item_name, '服务')
})

test('quotation customer search uses scoped server pagination and plain line payload', async () => {
  const { readFileSync } = await import('node:fs')
  const source = readFileSync(new URL('../app/components/AltocQuotationsPage.vue', import.meta.url), 'utf8')
  assert.match(source, /quotationItemsPayload\(quote.value\?\.row_version, lines.value\)/)
  assert.match(source, /v-model:search-term="customerSearch"/)
  assert.match(source, /page: requestedPage, pageSize: 20, .*search: customerDebounced.value/)
  assert.match(source, /<RemoteObjectSelectMenu/)
  assert.match(source, /selectedCustomer.value.*options.unshift/)
  assert.doesNotMatch(source, /<UInput\s+v-model="draft.customerId"/)
  assert.match(source, /voided: '已作废'/)
})

test('actual customer loader sends debounced search/page and ignores stale responses or a closed editor', async () => {
  const { readFileSync } = await import('node:fs')
  const { runInNewContext } = await import('node:vm')
  const { default: ts } = await import('typescript')
  const { parse } = await import('@vue/compiler-sfc')
  const source = readFileSync(new URL('../app/components/AltocQuotationsPage.vue', import.meta.url), 'utf8')
  const { descriptor } = parse(source)
  const program = ts.createSourceFile('quote.ts', descriptor.scriptSetup.content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const fn = program.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'loadCustomers')
  const compiled = ts.transpileModule('let customerEpoch = 0;\n' + fn.getText(program) + '\nexport { loadCustomers }', { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
  const exports = {}
  const open = { value: true }, customerPage = { value: 2 }, customerDebounced = { value: 'CU-01' }
  const customerRows = { value: [] }, customerHasMore = { value: false }, customerLoading = { value: false }
  const calls = [], resolve = []
  runInNewContext(compiled, {
    exports, open, customerPage, customerDebounced, customerRows, customerHasMore, customerLoading,
    customerError: { value: '' }, props: { detail: false }, canEdit: { value: true }, scopeKey: { value: 'scope' }, accessStatus: { value: 'ready' },
    $fetch: (path, options) => {
      calls.push({ path, options })
      return new Promise(done => resolve.push(done))
    }
  })
  const first = exports.loadCustomers()
  customerPage.value = 1
  customerDebounced.value = '新客户'
  const second = exports.loadCustomers()
  resolve[1]({ data: { items: [{ id: 2, code: 'CU-02', name: '新客户' }], total: 1 } })
  await second
  resolve[0]({ data: { items: [{ id: 1, code: 'CU-01', name: '旧客户' }], total: 50 } })
  await first
  assert.equal(customerRows.value[0].id, 2)
  assert.equal(customerHasMore.value, false)
  assert.equal(calls[0].path, '/altoc/api/v1/customers')
  assert.equal(calls[0].options.query.search, 'CU-01')
  assert.equal(calls[0].options.query.page, 1)
  open.value = false
  await exports.loadCustomers()
  assert.equal(calls.length, 2)
  assert.equal(customerRows.value.length, 0)
  assert.equal(customerLoading.value, false)
})
