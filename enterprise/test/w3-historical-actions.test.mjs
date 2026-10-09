import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse, compileScript } from '@vue/compiler-sfc'
import { historicalActions, historicalPayload, historicalWriteMessage } from '../app/utils/w3HistoricalContract.ts'

import { createRequire } from 'node:module'
import { build } from 'esbuild'
import { computed, reactive, ref, watch, onScopeDispose, effectScope, nextTick } from 'vue'
import * as historical from '../app/utils/w3HistoricalContract.ts'
import { requireAltocJsonMutationResult } from '../app/utils/altocBusinessObjectPresentation.ts'

const row = { id: 7, code: 'CT-SYNTHETIC', row_version: 4, origin_type: 'historical_import', status: 'effective' }
test('historical actions require explicit close, hide native actions and preserve line locks', () => {
  assert.equal(historicalActions(row, true, false).complete, false)

  assert.equal(historicalActions(row, true, false).projects, true)

  assert.equal(historicalActions(row, false, true).projects, false)

  assert.equal(historicalActions(row, false, true).terminate, true)

  assert.equal(historicalActions({ ...row, origin_type: 'native' }, true, true).annotate, false)

  assert.equal(historicalActions({ ...row, status: 'completed' }, true, true).complete, false)

  assert.equal(historicalActions({ ...row, status: 'terminated' }, true, true).annotate, true)

  const parent = readFileSync(new URL('../app/components/AltocContractsPage.vue', import.meta.url), 'utf8')

  assert.match(parent, /hasPermission\('contract', 'close'\)/)

  assert.match(parent, /v-if="historical"[\s\S]*:can-close="canClose"/)

  assert.match(parent, /v-if="!historical"/)
})
test('historical payloads only touch allowed columns; reserved owners, missing reason and invalid contact are rejected', () => {
  assert.deepEqual(historicalPayload('annotate', row, { contact_id: '', remark: '合成备注', content_summary: '合成摘要' }), { expectedVersion: 4, contact_id: null, remark: '合成备注', content_summary: '合成摘要' })

  assert.deepEqual(historicalPayload('owner', row, { owner_uid: 'synthetic-user', owner_dept_code: '' }), { expectedVersion: 4, owner_uid: 'synthetic-user' })

  assert.deepEqual(historicalPayload('projects', row, { project_code: 'PRJ-SYNTHETIC', project_name: '合成项目' }).projects, [{ projectCode: 'PRJ-SYNTHETIC', name: '合成项目', deptCode: '', create: false, lineCodes: [], obligationCodes: [], billingScheduleCodes: [] }])

  assert.throws(() => historicalPayload('owner', row, { owner_uid: 'system:unassigned' }), /在职/)

  assert.throws(() => historicalPayload('terminate', row, { reason: '' }), /原因/)

  assert.throws(() => historicalPayload('annotate', row, { contact_id: 'CU-SYNTHETIC' }), /联系人/)

  assert.equal(historicalWriteMessage({ statusCode: 403 }), '没有执行此合同操作的权限或对象已超出您的范围')

  assert.match(historicalWriteMessage({ statusCode: 409 }), /草稿已保留/)

  assert.match(historicalWriteMessage({ statusCode: 409, data: { code: 'finance_historical_contract_not_ready' } }), /财务输入尚未就绪/)
})
test('whole contract SFCs compile; closing confirmation contains code and irreversible effects, and no nested dialog', () => {
  for (const filename of ['W3HistoricalContractActions.vue', 'AltocContractsPage.vue']) {
    const source = readFileSync(new URL(`../app/components/${filename}`, import.meta.url), 'utf8')

    const { descriptor, errors } = parse(source, { filename })

    assert.deepEqual(errors, [])

    assert.doesNotThrow(() => compileScript(descriptor, { id: filename, inlineTemplate: true }))

    if (filename.startsWith('W3')) {
      assert.match(source, /tone: action.value === 'terminate' \? 'danger' : 'warning'/)

      assert.match(source, /contract_no \|\| props.contract.code/)

      assert.match(source, /不可在系统内撤销/)

      assert.match(source, /open.value = false[\s\S]*await nextTick\(\)[\s\S]*await confirm/)

      assert.match(source, /Idempotency-Key/)

      assert.match(source, /采用最新版本，保留草稿/)

      assert.match(source, /generation\+\+/)
    }
  }
})
const ts = createRequire(import.meta.url)('typescript')
const bundled = await build({ entryPoints: [new URL('../../foundation/shared/utils/reviewMutationIntent.ts', import.meta.url).pathname], bundle: true, format: 'cjs', platform: 'node', write: false })
const utility = { exports: {} }
new Function('module', 'exports', bundled.outputFiles[0].text)(utility, utility.exports)
function historyHarness(fetcher, confirmation = async () => true, permissions = { canEdit: true, canClose: true }) {
  const source = readFileSync(new URL('../app/components/W3HistoricalContractActions.vue', import.meta.url), 'utf8')

  const script = parse(source).descriptor.scriptSetup.content

  const program = ts.createSourceFile('component.ts', script, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)

  const statements = program.statements.filter(node => !ts.isImportDeclaration(node)).map(node => node.getText(program)).join('\n')

  const code = ts.transpileModule(statements + '\nreturn { open, action, begin, save, draft, error, version, comparison, adoptVersion }', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText

  const cache = ref('synthetic-session')

  const emitted = []

  const context = { ...historical, ...utility.exports, requireAltocJsonMutationResult, ref, computed, reactive, watch, onScopeDispose, nextTick, defineProps: () => ({ contract: row, ...permissions }), defineEmits: () => event => emitted.push(event), useState: () => cache, useConfirm: () => ({ confirm: confirmation }), useToast: () => ({ add: () => {} }), $fetch: fetcher }

  const scope = effectScope()

  const result = scope.run(() => new Function(...Object.keys(context), code)(...Object.values(context)))

  return { ...result, cache, emitted, stop: () => scope.stop() }
}
test('actual historical close uses exact route/CAS, danger confirmation with closed editor, and cancellation does not write', async () => {
  const writes = []

  const confirms = []

  let accepted = false

  const h = historyHarness(async (path, options) => {
    writes.push({ path, options })

    return { data: row }
  }, async (options) => {
    confirms.push(options)

    assert.equal(h.open.value, false)

    return accepted
  })

  h.begin('terminate')

  h.draft.reason = '合成中止原因'

  await h.save()

  assert.equal(writes.length, 0)

  assert.equal(h.open.value, true)

  accepted = true

  await h.save()

  assert.equal(confirms.at(-1).tone, 'danger')

  assert.match(confirms.at(-1).message, /CT-SYNTHETIC.*不可在系统内撤销/)

  assert.equal(writes[0].path, '/altoc/api/v1/contracts/7/terminate')

  assert.deepEqual(writes[0].options.body, { expectedVersion: 4, reason: '合成中止原因' })

  assert.ok(writes[0].options.headers['Idempotency-Key'])

  assert.deepEqual(h.emitted, ['saved'])

  h.stop()
})
test('actual historical editor retains draft on version conflict; unknown result retries original key and unauthorized close never writes', async () => {
  const writes = []

  let failure = { statusCode: 409, data: { code: 'altoc_contract_version_conflict' } }

  const h = historyHarness(async (path, options) => {
    if (!options.method) return { data: { ...row, row_version: 5, remark: '合成对方修改' } }

    writes.push({ path, options })

    if (failure) throw failure

    return { data: row }
  })

  h.begin('annotate')

  h.draft.remark = '合成保留草稿'

  await h.save()

  assert.equal(h.open.value, true)

  assert.equal(h.draft.remark, '合成保留草稿')

  assert.equal(h.comparison.value.row_version, 5)

  h.adoptVersion()

  failure = Error('fetch failed')

  await h.save()

  failure = null

  await h.save()

  assert.deepEqual(writes.at(-1), writes.at(-2))

  assert.equal(writes.at(-1).options.body.expectedVersion, 5)

  h.stop()

  const forbidden = historyHarness(async () => {
    assert.fail('unauthorized close wrote')
  }, async () => true, { canEdit: true, canClose: false })

  forbidden.begin('complete')

  await forbidden.save()

  forbidden.stop()
})

test('actual historical project linking sends only existing-project references and keeps historical lines locked', async () => {
  const writes = []

  const h = historyHarness(async (path, options) => {
    writes.push({ path, options })

    return { data: row }
  })

  h.begin('projects')

  h.draft.project_code = 'PRJ-SYNTHETIC'

  h.draft.project_name = '合成项目'

  await h.save()

  assert.equal(writes[0].path, '/altoc/api/v1/contracts/7/projects')

  assert.equal(writes[0].options.body.projects[0].create, false)

  assert.deepEqual(writes[0].options.body.projects[0].lineCodes, [])

  assert.ok(writes[0].options.headers['Idempotency-Key'])

  h.stop()
})
