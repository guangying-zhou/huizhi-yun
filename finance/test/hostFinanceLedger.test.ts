import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { createFinanceIntent } from '../app/utils/hostFinanceForms.ts'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import { ledgerWriteMessage, ledgerAmount, ledgerApi, isSpend, ledgerStatusLabel } from '../app/utils/hostFinanceLedger.ts'

test('APF11a forms keep uncertainty, separation and conflict messages in Chinese', () => {
  assert.match(ledgerWriteMessage({ data: { code: 'finance_invoice_issue_duty_separation_required' } }), /申请人不能是开票人/)
  assert.match(ledgerWriteMessage({ data: { code: 'finance_reconciliation_duty_separation_required' } }), /确认人不能是核销人/)
  assert.match(ledgerWriteMessage({ statusCode: 409 }), /刷新比较.*草稿已保留/)
  assert.match(ledgerWriteMessage(new Error('fetch /secret')), /保存结果未确认.*同一请求/)
  assert.equal(ledgerAmount({ id: 1, code: 'MARKED', row_version: 1, status: 'issued', currency_code: 'CNY', invoice_amount: '9999999999999999.99' }), '9999999999999999.99')
})
test('APF11a full components and page SFC compile; no raw confirm or manual invoice create', () => {
  const components = ['FinanceLedgerList.vue', 'FinanceLedgerForm.vue', 'FinanceLedgerDetail.vue']
  for (const filename of components) {
    const source = readFileSync(new URL(`../app/components/host/${filename}`, import.meta.url), 'utf8')
    const { descriptor, errors } = parse(source, { filename })
    assert.deepEqual(errors, [])
    const script = compileScript(descriptor, { id: filename })
    assert.deepEqual(compileTemplate({ source: descriptor.template!.content, filename, id: filename, compilerOptions: { bindingMetadata: script.bindings } }).errors, [])
    assert.doesNotMatch(source, /window\.(?:confirm|alert)\(/)
  }
  for (const filename of readdirSync(new URL('../layer/pages/', import.meta.url)).filter(n => /^(invoice|receipts|reconciliation)/.test(n))) {
    const source = readFileSync(new URL(`../layer/pages/${filename}`, import.meta.url), 'utf8')
    const { descriptor } = parse(source, { filename })
    const script = compileScript(descriptor, { id: filename })
    assert.deepEqual(compileTemplate({ source: descriptor.template!.content, filename, id: filename, compilerOptions: { bindingMetadata: script.bindings } }).errors, [])
  }
  const form = readFileSync(new URL('../app/components/host/FinanceLedgerForm.vue', import.meta.url), 'utf8')
  assert.match(form, /frozenPayload/)
  assert.match(form, /!retrying/)
  const entry = readFileSync(new URL('../layer/entry.mjs', import.meta.url), 'utf8')
  assert.doesNotMatch(entry, /page\('\/invoices\/new'/)
  const list = readFileSync(new URL('../app/components/host/FinanceLedgerList.vue', import.meta.url), 'utf8')
  assert.match(list, /:loading="pending"/)
  assert.match(list, /#empty/)
  assert.match(list, /共 \{\{ total \}\} 条/)
})

test('APF11b submit retries keep frozen version and separate source authorization from browser facts', () => {
  const detail = readFileSync(new URL('../app/components/host/FinanceLedgerDetail.vue', import.meta.url), 'utf8')
  assert.match(detail, /submitPayload\.value \|\|=/)
  assert.match(detail, /row.requested_by === currentUser/)
  assert.match(detail, /\['submit', 'confirm', 'red-reverse'\]/)
  assert.match(ledgerWriteMessage({ statusCode: 503, data: { requestFrozen: true } }), /申请已冻结.*同一请求/)
  const form = readFileSync(new URL('../app/components/host/FinanceLedgerForm.vue', import.meta.url), 'utf8')
  assert.match(form, /expectedVersion = Number\(route.query.expectedVersion\)/)
  assert.match(form, /scheduleVersion = Number\(route.query.scheduleVersion\)/)
  assert.match(form, /billing-schedules\/\$\{encodeURIComponent\(sourceSchedule.value\)\}\/invoice-request/)
  assert.doesNotMatch(form, /altocAuthorization|approved: true/)
})

test('actual submit handler keeps its original version/key after uncertain delivery and a refreshed row', async () => {
  const source = readFileSync(new URL('../app/components/host/FinanceLedgerDetail.vue', import.meta.url), 'utf8')
  const { descriptor } = parse(source)
  const program = ts.createSourceFile('detail.ts', descriptor.scriptSetup!.content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const execute = program.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'execute')!
  const compiled = ts.transpileModule(execute.getText(program) + '\nexport { execute }', { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
  const requests: Array<{ body: { expectedVersion: number }, headers: { 'Idempotency-Key': string } }> = []
  const row = { value: { code: 'IR1', row_version: 1, status: 'draft' } }
  const submitPayload = { value: null as { expectedVersion: number } | null }
  const action = { value: 'submit' as string | null }
  const exports: { execute?: () => Promise<void> } = {}
  let fail = true
  let reads = 0
  runInNewContext(compiled, {
    exports, row, submitPayload, action, saving: { value: false }, confirming: { value: false }, needsForm: { value: false }, nextTick: async () => {},
    actionLabel: { value: '提交审批' }, confirm: async () => true,
    reason: { value: '' }, invoiceNo: { value: '' }, props: { kind: 'invoice-requests' },
    apiUrl: (path: string) => '/finance/api/v1' + path,
    intent: createFinanceIntent(() => 'stable-key'), ledgerWriteMessage, ledgerApi, isSpend,
    toast: { add: () => {} }, load: async () => { reads++ },
    $fetch: async (_url: string, options: typeof requests[number]) => {
      requests.push(structuredClone(options))
      if (fail) throw { statusCode: 503, data: { requestFrozen: true } }
    }
  })
  await exports.execute!()
  assert.equal(submitPayload.value?.expectedVersion, 1)
  assert.equal(reads, 0, 'uncertain submit must preserve local state')
  row.value.row_version = 99
  fail = false
  action.value = 'submit'
  await exports.execute!()
  assert.deepEqual(requests.map(r => r.body.expectedVersion), [1, 1])
  assert.deepEqual(requests.map(r => r.headers['Idempotency-Key']), ['stable-key', 'stable-key'])
  assert.equal(reads, 1)
  assert.equal(submitPayload.value, null)
  // A fresh load has no local frozen payload; resume delegates lookup to Runtime.
  row.value.row_version = 3
  row.value.status = 'pending_approval'
  action.value = 'resume'
  await exports.execute!()
  assert.deepEqual(requests[2]!.body, { expectedVersion: 3, recover: true })
  assert.equal(submitPayload.value, null)
})

test('submit opens only the shared confirmation; reason-requiring actions retain their form', async () => {
  const source = readFileSync(new URL('../app/components/host/FinanceLedgerDetail.vue', import.meta.url), 'utf8')
  const { descriptor } = parse(source)
  const program = ts.createSourceFile('detail.ts', descriptor.scriptSetup!.content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const choose = program.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'chooseAction')!
  const compiled = ts.transpileModule(choose.getText(program) + '\nexport { chooseAction }', { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
  const action = { value: null as string | null }
  const needsForm = { get value() {
    return ['void', 'red-reverse'].includes(action.value || '')
  } }
  const exports: { chooseAction?: (next: string) => Promise<void> } = {}
  let confirmations = 0
  runInNewContext(compiled, { exports, action, needsForm, saving: { value: false }, confirming: { value: false }, execute: async () => {
    confirmations++
  } })
  await exports.chooseAction!('submit')
  assert.equal(needsForm.value, false)
  assert.equal(confirmations, 1)
  await exports.chooseAction!('void')
  assert.equal(needsForm.value, true)
  assert.equal(confirmations, 1, 'form is collected before confirmation')
  assert.match(source, /get: \(\) => action.value !== null && needsForm.value && !confirming.value/)
})

test('request cancellation and unknown states do not show invoice wording or raw enums', () => {
  assert.equal(ledgerStatusLabel('canceled', 'claims'), '已取消')
  assert.equal(ledgerStatusLabel('canceled', 'invoices'), '已作废')
  assert.equal(ledgerStatusLabel('future_state', 'claims'), '未知状态')
})

test('pending unbound requests expose server-owned recovery after refresh', () => {
  const detail = readFileSync(new URL('../app/components/host/FinanceLedgerDetail.vue', import.meta.url), 'utf8')
  assert.match(detail, /恢复提交/)
  assert.match(detail, /row.status === 'pending_approval' && !row.workflow_instance_id/)
  assert.match(detail, /hasPermission\(ledgerResource\[kind\], 'edit'\)/)
  assert.match(detail, /row.applicant_uid === currentUser \|\| row.requested_by === currentUser/)
  assert.match(detail, /currentAction === 'resume' \? \{ expectedVersion: row.value.row_version, recover: true \}/)
  assert.match(detail, /currentAction === 'resume' \? '\/submit'/)
  assert.doesNotMatch(detail, /requestNo:|originalKey:/)
})
