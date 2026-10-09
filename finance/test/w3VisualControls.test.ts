import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { parse, compileScript } from '@vue/compiler-sfc'
import { ref, reactive, computed, watch, effectScope, nextTick } from 'vue'
import { accountW3Patch } from '../app/utils/w3AccountForms.ts'
import { createFinanceIntent, financeWriteMessage } from '../app/utils/hostFinanceForms.ts'
import { createHostFinanceClient } from '../app/utils/hostFinanceClient.ts'

const source = readFileSync(new URL('../app/components/host/BankAccountEditor.vue', import.meta.url), 'utf8')
function editor(account: Record<string, unknown>) {
  const program = ts.createSourceFile('editor.ts', parse(source).descriptor.scriptSetup!.content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const script = program.statements.filter(node => !ts.isImportDeclaration(node)).map(node => node.getText(program)).join('\n')
  const code = ts.transpileModule(script + '\nreturn { form, subtypeSelection, open, submit }', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  const writes: { body: Record<string, unknown> }[] = []
  const context = { ref, reactive, computed, watch, accountW3Patch, createFinanceIntent, financeWriteMessage, createHostFinanceClient, defineProps: () => ({ account, canEdit: true }), defineModel: () => ref(false), defineEmits: () => () => {}, useFinanceModule: () => ({ apiUrl: (path: string) => '/finance/api/v1' + path }), useToast: () => ({ add: () => {} }), $fetch: async (_url: string, options: { body: Record<string, unknown> }) => {
    writes.push(options)
    return { data: account }
  } }
  const scope = effectScope()
  const state = scope.run(() => new Function(...Object.keys(context), code)(...Object.values(context)))
  return { ...state, writes, stop: () => scope.stop() }
}
test('account subtype select uses a nonempty UI value but clears to the existing nullable write contract', async () => {
  const state = editor({ code: 'BA-SYNTHETIC', account_name: '合成账户', account_type: 'bank', currency_code: 'CNY', account_subtype: 'basic', short_name: null, row_version: 2 })
  try {
    state.open.value = true
    await nextTick()
    assert.equal(state.subtypeSelection.value, 'basic')
    state.subtypeSelection.value = 'unregistered'
    assert.equal(state.form.accountSubtype, '')
    await state.submit()
    assert.equal(state.writes[0].body.accountSubtype, null)
    assert.equal(state.writes[0].body.expectedVersion, 2)
  } finally { state.stop() }
})
test('uninstalled subtype remains omitted when the nonempty placeholder is unchanged', async () => {
  const state = editor({ code: 'BA-SYNTHETIC', account_name: '合成账户', account_type: 'bank', currency_code: 'CNY', row_version: 2 })
  try {
    state.open.value = true
    await nextTick()
    assert.equal(state.subtypeSelection.value, 'unregistered')
    await state.submit()
    assert.equal(Object.hasOwn(state.writes[0].body, 'accountSubtype'), false)
    assert.ok(!JSON.stringify(state.writes[0]).includes('unregistered'))
  } finally { state.stop() }
})
test('W3 account and queue SFCs compile without empty Select items and with described dialogs', () => {
  for (const file of ['BankAccountEditor.vue', 'W3MigrationQueuePage.vue', 'W3BalanceEvidence.vue']) {
    const text = readFileSync(new URL(`../app/components/host/${file}`, import.meta.url), 'utf8')
    const { descriptor, errors } = parse(text, { filename: file })
    assert.deepEqual(errors, [])
    assert.doesNotThrow(() => compileScript(descriptor, { id: file, inlineTemplate: true }))
    assert.doesNotMatch(text, /value: ''/)
    assert.match(text, /description=/)
  }
})
