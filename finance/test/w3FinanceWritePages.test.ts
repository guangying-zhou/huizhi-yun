import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import { balanceDraft, accountW3Patch } from '../app/utils/w3AccountForms.ts'
import { createFinanceIntent, financeWriteMessage } from '../app/utils/hostFinanceForms.ts'
import { createHostFinanceClient, type FinanceFetchOptions } from '../app/utils/hostFinanceClient.ts'
import { financeObjectOptions } from '../app/utils/hostFinanceObjectChoices.ts'
import type { BankAccount } from '../app/types/hostFinance'

function actualFunction(name: string, file: string) {
  const source = readFileSync(new URL(`../app/components/host/${file}`, import.meta.url), 'utf8')
  const program = ts.createSourceFile(file, parse(source).descriptor.scriptSetup!.content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const fn = program.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name)!
  return ts.transpileModule(fn.getText(program) + `\nexport { ${name} }`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
}

test('W3 balance amount/date validation preserves precision and absent account columns are not written', () => {
  assert.deepEqual(balanceDraft('2026-10-01', '-9007199254740993.01', ' note '), { balanceDate: '2026-10-01', balanceAmount: '-9007199254740993.01', note: 'note' })
  assert.throws(() => balanceDraft('2026-02-30', '1', ''), /有效/)
  assert.throws(() => balanceDraft('2026-10-01', '1.234', ''), /金额/)
  const empty = { shortName: '', bankBranchCode: '', legalEntityCode: '', accountSubtype: '', sortNo: 0 }
  assert.deepEqual(accountW3Patch(empty, {} as BankAccount), {})
  assert.deepEqual(accountW3Patch(empty, null), {})
  assert.deepEqual(accountW3Patch({ ...empty, shortName: 'main' }, {} as BankAccount), { shortName: 'main' })
  assert.equal(accountW3Patch(empty, { short_name: 'previous' } as BankAccount).shortName, null)
  assert.throws(() => accountW3Patch({ ...empty, sortNo: -1 }, null), /排序/)
  assert.match(financeWriteMessage({ statusCode: 409, data: { code: 'finance_account_fields_unavailable' } }), /尚未启用/)
  assert.match(financeWriteMessage({ statusCode: 409, data: { code: 'finance_balance_date_invalid' } }), /未来日期/)
})

test('W3 directory and register transports use existing precise endpoints, CAS and original retry key', async () => {
  const calls: { url: string, options: FinanceFetchOptions }[] = []
  const api = createHostFinanceClient(async <T>(url: string, options: FinanceFetchOptions) => {
    calls.push({ url, options })
    return {} as T
  }, path => `/finance/api/v1${path}`)
  await api.entities({ page: 1, pageSize: 100 })
  await api.updateEntity('LE/1', { status: 'inactive', expectedVersion: 4 }, 'original')
  await api.balanceEntries('BA/1', '2026-10-01', 2)
  const body = balanceDraft('2026-10-01', '10.01', '')
  await api.registerBalance('BA/1', body, 'register-original')
  await api.registerBalance('BA/1', body, 'register-original')
  assert.equal(calls[0]!.url, '/finance/api/v1/legal-entities')
  assert.deepEqual(calls[1]!.options.body, { status: 'inactive', expectedVersion: 4 })
  assert.deepEqual(calls[2]!.options.query, { date: '2026-10-01', page: 2, pageSize: 20 })
  assert.equal(calls[3]!.url, '/finance/api/v1/bank-accounts/BA%2F1/balance-entries')
  assert.deepEqual(calls[3], calls[4])
  assert.ok(calls.every(call => call.options.retry === 0))
  const row = { id: 7, code: 'BA7', status: 'active' }
  assert.equal(financeObjectOptions([row], 'bank-accounts')[0]!.value, '7')
  assert.equal(financeObjectOptions([row], 'bank-accounts', 'code')[0]!.value, 'BA7')
  assert.equal(financeObjectOptions([{ ...row, status: 'inactive' }], 'legal-entities')[0]!.disabled, true)
})

test('actual register submit blocks invalid inputs before IO and retains failed draft/original key', async () => {
  const calls: string[] = []
  const state = { exports: {} as { submit: () => Promise<void> }, props: { canRegister: true }, saving: { value: false }, form: { code: 'BA7', date: '2026-02-30', amount: '12.00', note: '' }, error: { value: '' }, open: { value: true }, balanceDraft, financeWriteMessage, intent: createFinanceIntent(() => 'original'), api: { registerBalance: async (_code: string, _body: unknown, key: string) => {
    calls.push(key)
    throw { statusCode: 503 }
  } }, toast: { add: () => {} }, emit: () => assert.fail('failed write must not emit saved') }
  runInNewContext(actualFunction('submit', 'BalanceRegister.vue'), state)
  await state.exports.submit()
  assert.equal(calls.length, 0)
  state.form.date = '2026-10-01'
  await state.exports.submit()
  await state.exports.submit()
  assert.deepEqual(calls, ['original', 'original'])
  assert.equal(state.open.value, true)
  assert.equal(state.saving.value, false)
  assert.equal(state.form.amount, '12.00')
  assert.match(state.error.value, /服务暂时不可用/)
  state.props.canRegister = false
  await state.exports.submit()
  assert.equal(calls.length, 2)
})

test('actual entity editing retains draft on 409 and sends current expectedVersion', async () => {
  const bodies: unknown[] = []
  const state = { exports: {} as { submit: () => Promise<void> }, canEdit: { value: true }, saving: { value: false }, form: { name: 'Draft', shortName: '', entityType: 'company', sortNo: 0 }, editing: { value: { code: 'LE7' } }, version: { value: 4 }, saveError: { value: '' }, open: { value: true }, intent: createFinanceIntent(() => 'same'), financeWriteMessage, api: { updateEntity: async (_code: string, body: unknown) => {
    bodies.push(body)
    throw { statusCode: 409 }
  } }, toast: { add: () => {} }, refresh: () => assert.fail('failed save must not discard draft') }
  runInNewContext(actualFunction('submit', 'LegalEntitiesPage.vue'), state)
  await state.exports.submit()
  assert.equal((bodies[0] as { expectedVersion: number }).expectedVersion, 4)
  assert.equal(state.form.name, 'Draft')
  assert.equal(state.open.value, true)
  assert.equal(state.saving.value, false)
  assert.match(state.saveError.value, /刷新比较/)
})

test('W3 entity and balance SFCs compile with explicit shared imports, mobile cards and real entry paging', () => {
  for (const file of ['LegalEntitiesPage.vue', 'BalanceRegister.vue', 'BankAccountEditor.vue']) {
    const source = readFileSync(new URL(`../app/components/host/${file}`, import.meta.url), 'utf8')
    const { descriptor, errors } = parse(source, { filename: file })
    assert.deepEqual(errors, [])
    const script = compileScript(descriptor, { id: file })
    assert.deepEqual(compileTemplate({ source: descriptor.template!.content, filename: file, id: file, compilerOptions: { bindingMetadata: script.bindings } }).errors, [])
    if (source.includes('<CommonEmptyState')) assert.match(source, /import CommonEmptyState from/)
    if (source.includes('<ContentPageHeader')) assert.match(source, /import ContentPageHeader from/)
    assert.doesNotMatch(source, /window\.(?:alert|confirm)\(/)
  }
  const page = readFileSync(new URL('../app/components/host/LegalEntitiesPage.vue', import.meta.url), 'utf8')
  assert.match(page, /useConfirm/)
  assert.match(page, /sm:hidden/)
  assert.match(page, /法人主体目录不可用/)
  const entries = readFileSync(new URL('../app/components/host/BalanceRegister.vue', import.meta.url), 'utf8')
  assert.match(entries, /:items-per-page="20"/)
  assert.match(entries, /原系统人员/)
})
