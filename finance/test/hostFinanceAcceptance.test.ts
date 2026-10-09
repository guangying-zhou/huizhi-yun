import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import { ledgerRequiredFields, validateLedgerForm } from '../app/utils/hostFinanceLedgerValidation.ts'
import { financeObjectOptions, financeChoicePage, financeChoiceError } from '../app/utils/hostFinanceObjectChoices.ts'

const source = (name: string) => readFileSync(new URL('../app/components/host/' + name, import.meta.url), 'utf8')
function actualFunction(name: string, filename: string) {
  const program = ts.createSourceFile(filename, parse(source(filename)).descriptor.scriptSetup!.content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const fn = program.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name)!
  return ts.transpileModule(fn.getText(program) + `\nexport { ${name} }`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
}

test('invoice attachments and receipt deadlines validate before confirmation or network IO', async () => {
  const titles: string[] = []
  const errors = { value: {} }
  const exports: { save?: () => Promise<void> } = {}
  runInNewContext(actualFunction('save', 'FinanceLedgerForm.vue'), {
    exports, allowed: { value: true }, saving: { value: false }, fieldErrors: errors,
    props: { kind: 'invoice-requests' }, mode: { value: 'issue' }, form: { invoiceNo: 'FIXTURE', invoiceDate: '2026-10-04' },
    fields: { value: [{ key: 'invoiceNo', label: '发票号码' }, { key: 'invoiceDate', label: '开票日期', type: 'date' }] },
    file: { value: null }, attachment: { value: null }, saveError: { value: '' }, validateLedgerForm,
    toast: { add: ({ title }: { title: string }) => titles.push(title) },
    confirm: () => assert.fail('must validate before confirmation'), $fetch: () => assert.fail('must validate before network IO')
  })
  await exports.save!()
  assert.deepEqual(titles, ['请上传发票 PDF/OFD 附件'])
  assert.equal(errors.value.attachment, '请上传发票 PDF/OFD 附件')
  const fields = [{ key: 'receivedAmount', label: '到账金额', amount: true }, { key: 'currencyCode', label: '币种' }, { key: 'receivedAt', label: '到账日期', type: 'date' }, { key: 'responsibleUid', label: '核销责任人' }, { key: 'dueAt', label: '核销截止时间', type: 'datetime-local' }]
  const form = { receivedAmount: '20.00', currencyCode: 'CNY', receivedAt: '2026-10-04', responsibleUid: 'reviewer', dueAt: '' }
  assert.equal(validateLedgerForm('receipts', 'create', form, fields, false).dueAt, '请填写核销截止时间')
  assert.deepEqual(validateLedgerForm('receipts', 'create', { ...form, dueAt: '2026-10-05T14:00' }, fields, false), {})
  assert.ok(validateLedgerForm('receipts', 'create', { ...form, dueAt: '2026-02-30T14:00', receivedAmount: 'bad' }, fields, false).receivedAmount)
  assert.ok(validateLedgerForm('receipts', 'create', { ...form, dueAt: '2026-10-05T24:00' }, fields, false).dueAt)
  assert.deepEqual(ledgerRequiredFields('invoice-requests', 'create'), ['invoiceItem', 'requestedAmount', 'currencyCode'])
})

test('selectors retain API identifiers, masked bank labels and distinct denied/failure states', () => {
  assert.equal(financeObjectOptions([{ id: 1, code: 'CU-1', name: '客户' }], 'customers')[0].value, 'CU-1')
  const account = financeObjectOptions([{ id: 2, code: 'BA-1', account_name: '出纳户', status: 'active' }], 'bank-accounts')[0]
  assert.equal(account.value, '2')
  assert.match(account.label, /出纳户/)
  assert.equal(account.disabled, false)
  assert.equal(financeObjectOptions([{ id: 3, code: 'BA-2', status: 'inactive' }], 'bank-accounts')[0].disabled, true)
  assert.deepEqual(financeChoicePage({ data: { items: [{ id: 1, code: 'CT-1' }], total: 1 } }), { items: [{ id: 1, code: 'CT-1' }], total: 1 })
  assert.equal(financeChoicePage({ data: [{ id: 1, code: 'BS-1' }], total: 1 }).total, 1)
  assert.throws(() => financeChoicePage('<html>SPA</html>'))
  assert.match(financeChoiceError({ statusCode: 403 }), /没有查看/)
  assert.match(financeChoiceError({ statusCode: 503 }), /加载失败/)
})

test('actual selector loader rejects stale replies and uses the exact owning contract for plans', async () => {
  const calls: Array<{ url: string, options: unknown, resolve: (result: unknown) => void }> = []
  const props = { enabled: true, kind: 'customers', contractCode: 'CT-1' }
  const options = { value: [] }
  const loading = { value: false }
  const error = { value: '' }
  const exports: { load?: () => Promise<void> } = {}
  runInNewContext('let epoch=0;\n' + actualFunction('load', 'FinanceBusinessObjectSelect.vue'), {
    exports, props, options, total: { value: 0 }, loading, error, sessionScope: { value: 'S1' }, hasMore: { value: false }, page: { value: 1 }, debounced: { value: 'CU' },
    apiUrl: (path: string) => '/finance/api/v1' + path, financeObjectOptions, financeChoicePage, financeChoiceError,
    $fetch: (url: string, opts: unknown) => new Promise(resolve => calls.push({ url, options: opts, resolve }))
  })
  const stale = exports.load!()
  const current = exports.load!()
  calls[1].resolve({ data: { items: [{ id: 2, code: 'CU-2' }], total: 1 } })
  await current
  calls[0].resolve({ data: { items: [{ id: 1, code: 'CU-1' }], total: 1 } })
  await stale
  assert.equal((options.value[0] as { value: string }).value, 'CU-2')
  props.kind = 'billing-schedules'
  const plans = exports.load!()
  calls[2].resolve({ data: { items: [{ id: 7, code: 'CT-1' }], total: 1 } })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(calls[3].url, '/altoc/api/v1/contracts/7/billing-schedules')
  calls[3].resolve({ data: [{ id: 3, code: 'BS-1', direction: 'receivable' }], total: 1 })
  await plans
  assert.equal(loading.value, false)
})

test('Finance forms, selectors and lists compile with required fields, personnel picker and cashier explanation', () => {
  for (const filename of ['FinanceLedgerForm.vue', 'FinanceBusinessObjectSelect.vue', 'FinanceLedgerList.vue']) {
    const { descriptor, errors } = parse(source(filename))
    assert.deepEqual(errors, [])
    const script = compileScript(descriptor, { id: filename })
    assert.deepEqual(compileTemplate({ source: descriptor.template!.content, filename, id: filename, compilerOptions: { bindingMetadata: script.bindings } }).errors, [])
  }
  assert.match(source('FinanceLedgerForm.vue'), /:required="requiredFields.includes\(field.key\)"/)
  assert.match(source('FinanceLedgerForm.vue'), /:error="fieldErrors\[field.key\]"/)
  assert.match(source('FinanceLedgerForm.vue'), /UserTreeSelector/)
  assert.match(source('FinanceLedgerList.vue'), /由另一位财务办理分配/)
})
