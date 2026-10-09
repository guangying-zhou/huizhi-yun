import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { createFinanceIntent } from '../app/utils/hostFinanceForms.ts'
import { ledgerWriteMessage, ledgerPath, ledgerApi, ledgerResource } from '../app/utils/hostFinanceLedger.ts'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import { financeSettings, settingsPayload } from '../app/utils/hostFinanceSettings.ts'

test('APF13b configuration payload keeps numeric and boolean types and trusted fields closed', () => {
  assert.deepEqual(settingsPayload('expense-types', { code: 'FIXED', name: 'Draft', reimbursable: false, defaultSubjectId: '2', status: 'inactive', actor: 'forged' }, true, 3), { name: 'Draft', defaultSubjectId: 2, reimbursable: false, status: 'inactive', remark: null, expectedVersion: 3, costCategory: null })
  const mapping = settingsPayload('subject-mappings', { bizType: 'expense', defaultSubjectCode: '6001', objectStrategy: 'manual', requiredDimensions: 'project, contract', status: 'active' }, false)
  assert.deepEqual(mapping.requiredDimensions, ['project', 'contract'])
  assert.ok(!('actor' in mapping))
  assert.equal(ledgerPath('payment-requests'), '/payment-requests')
  assert.equal(ledgerApi('payment-requests'), 'payment-requests')
  assert.equal(ledgerResource['payment-requests'], 'expenses')
})
test('APF13b settings and payment pages compile fully and expose safe list/form states', () => {
  const filenames = ['FinanceSettingsPage.vue', 'FinanceSpendForm.vue']
  for (const filename of filenames) {
    const source = readFileSync(new URL(`../app/components/host/${filename}`, import.meta.url), 'utf8')
    const { descriptor, errors } = parse(source, { filename })
    assert.deepEqual(errors, [])
    const script = compileScript(descriptor, { id: filename })
    assert.deepEqual(compileTemplate({ source: descriptor.template!.content, filename, id: filename, compilerOptions: { bindingMetadata: script.bindings } }).errors, [])
    assert.doesNotMatch(source, /window\.(confirm|alert)/)
  }
  for (const filename of readdirSync(new URL('../layer/pages', import.meta.url)).filter(name => /^(settings-|payment-requests-)/.test(name))) {
    const { descriptor, errors } = parse(readFileSync(new URL(`../layer/pages/${filename}`, import.meta.url), 'utf8'), { filename })
    assert.deepEqual(errors, [])
    const script = compileScript(descriptor, { id: filename })
    assert.deepEqual(compileTemplate({ source: descriptor.template!.content, filename, id: filename, compilerOptions: { bindingMetadata: script.bindings } }).errors, [])
  }
  const source = readFileSync(new URL('../app/components/host/FinanceSettingsPage.vue', import.meta.url), 'utf8')
  for (const expected of ['hasPermission(\'settings\', \'admin\')', ':loading="pending"', '#empty', 'CommonEmptyState', '共 {{ total }} 条', 'UPagination', 'useDebouncedSearch', 'useConfirm', 'frozen ||= settingsPayload', 'load(true)', 'comparison', 'sm:hidden']) assert.ok(source.includes(expected), expected)
  assert.equal(financeSettings['audit-logs'].fields.length, 0)
  assert.equal(financeSettings['approval-instances'].fields.length, 0)
})

test('actual configuration save retries its frozen draft and key after response loss', async () => {
  const source = readFileSync(new URL('../app/components/host/FinanceSettingsPage.vue', import.meta.url), 'utf8')
  const { descriptor } = parse(source)
  const program = ts.createSourceFile('settings.ts', descriptor.scriptSetup!.content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const save = program.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'save')!
  const compiled = ts.transpileModule(`let frozen = null; let generation = 1;\n${save.getText(program)}\nexport { save }`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
  const requests: Array<{ body: Record<string, unknown>, headers: { 'Idempotency-Key': string } }> = []
  const form = { code: '6001', name: 'Original', subjectType: 'cost', status: 'active' }
  const exports: { save?: () => Promise<void> } = {}
  const saving = { value: false }
  let fail = true
  runInNewContext(compiled, {
    exports, allowed: { value: true }, saving, saveError: { value: '' }, props: { kind: 'subjects' }, config: { value: financeSettings.subjects }, code: { value: '6001' }, original: { value: { row_version: 1 } },
    form, settingsPayload, ledgerWriteMessage, confirm: async () => true, load: async () => {},
    intent: createFinanceIntent(() => 'stable'), apiUrl: (path: string) => path, moduleUrl: (path: string) => path,
    $fetch: async (_path: string, request: typeof requests[number]) => {
      requests.push(request)
      if (fail) throw new Error('fetch /internal')
      return { data: { code: '6001' } }
    }, router: { push: async () => {} }, toast: { add: () => {} }
  })
  await exports.save!()
  assert.equal(saving.value, false)
  form.name = 'Changed during uncertain save'
  fail = false
  await exports.save!()
  assert.equal(requests[0]!.body.name, 'Original')
  assert.equal(requests[1]!.body.name, 'Original')
  assert.equal(requests[0]!.headers['Idempotency-Key'], requests[1]!.headers['Idempotency-Key'])
})
