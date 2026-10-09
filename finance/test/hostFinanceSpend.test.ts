import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { ledgerApi, ledgerPath, ledgerAmount, ledgerWriteMessage } from '../app/utils/hostFinanceLedger.ts'
import { createFinanceIntent } from '../app/utils/hostFinanceForms.ts'

test('APF13a amount strings, precise navigation and separation messages', () => {
  assert.equal(ledgerApi('claims'), 'expense-claims')
  assert.equal(ledgerPath('project-requests'), '/expenses/project-requests')
  assert.equal(ledgerAmount({ id: 1, code: 'CLM1', status: 'approved', row_version: 1, currency_code: 'CNY', total_amount: '90071992547409.91' }), '90071992547409.91')
  assert.match(ledgerWriteMessage({ data: { code: 'finance_payment_confirmation_duty_separation_required' } }), /制单人或经办人/)
})
test('APF13a full SFC forms and routes compile with accessible mobile item controls', () => {
  for (const filename of ['FinanceSpendForm.vue', 'FinanceLedgerList.vue', 'FinanceLedgerDetail.vue']) {
    const source = readFileSync(new URL(`../app/components/host/${filename}`, import.meta.url), 'utf8')
    const { descriptor, errors } = parse(source, { filename })
    assert.deepEqual(errors, [])
    const script = compileScript(descriptor, { id: filename })
    assert.deepEqual(compileTemplate({ source: descriptor.template!.content, filename, id: filename, compilerOptions: { bindingMetadata: script.bindings } }).errors, [])
    assert.doesNotMatch(source, /window\.(confirm|alert)\(/)
  }
  for (const filename of readdirSync(new URL('../layer/pages', import.meta.url)).filter(name => /^(expenses|claims|project-requests)/.test(name))) {
    const source = readFileSync(new URL(`../layer/pages/${filename}`, import.meta.url), 'utf8')
    const { descriptor } = parse(source, { filename })
    const script = compileScript(descriptor, { id: filename })
    assert.deepEqual(compileTemplate({ source: descriptor.template!.content, filename, id: filename, compilerOptions: { bindingMetadata: script.bindings } }).errors, [])
  }
  const detail = readFileSync(new URL('../app/components/host/FinanceLedgerDetail.vue', import.meta.url), 'utf8')
  assert.match(detail, /row.applicant_uid === currentUser/)
  assert.match(detail, /hasPermission\('expenses', 'confirm'\)/)
  assert.match(detail, /制单人和经办人不能确认自己的付款/)
  assert.doesNotMatch(detail, /status: 'paid'|approved: true/)
})
test('actual spend form retains its original payload and key after an unknown save response', async () => {
  const source = readFileSync(new URL('../app/components/host/FinanceSpendForm.vue', import.meta.url), 'utf8')
  const { descriptor } = parse(source)
  const program = ts.createSourceFile('spend.ts', descriptor.scriptSetup!.content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const save = program.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'save')!
  const compiled = ts.transpileModule(`let frozenPayload = null; let generation = 1;\n${save.getText(program)}\nexport { save }`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
  const requests: Array<{ body: { title: string, expectedVersion: number }, headers: { 'Idempotency-Key': string } }> = []
  const exports: { save?: () => Promise<void> } = {}
  let fail = true
  let title = 'Original'
  const saving = { value: false }
  runInNewContext(compiled, {
    exports, allowed: { value: true }, saving, saveError: { value: '' }, props: { kind: 'claims' }, code: { value: 'CLM1' },
    payload: () => ({ title, expectedVersion: 1 }), ledgerApi, ledgerPath, ledgerWriteMessage,
    intent: createFinanceIntent(() => 'stable'), apiUrl: (path: string) => path, moduleUrl: (path: string) => path,
    $fetch: async (_path: string, request: typeof requests[number]) => {
      requests.push(request)
      if (fail) throw new Error('fetch /internal')
      return { data: { code: 'CLM1' } }
    },
    router: { push: async () => {} }, toast: { add: () => {} }
  })
  await exports.save!()
  assert.equal(saving.value, false)
  title = 'Changed draft during uncertain save'
  fail = false
  await exports.save!()
  assert.equal(requests[0]!.body.title, 'Original')
  assert.equal(requests[1]!.body.title, 'Original')
  assert.equal(requests[0]!.headers['Idempotency-Key'], requests[1]!.headers['Idempotency-Key'])
})
