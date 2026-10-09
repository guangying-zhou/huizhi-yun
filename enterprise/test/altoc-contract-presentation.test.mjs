import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import { altocBusinessObjectOptions, altocContractStatusLabels, requireAltocJsonMutationResult } from '../app/utils/altocBusinessObjectPresentation.ts'
import { apfObjectSpecs, apfChoicePage, apfChoiceOptions } from '../app/utils/apfObjectChoices.ts'
import ts from 'typescript'
import { runInNewContext } from 'node:vm'

test('contract line statuses and source quotation selections match owning facts', () => {
  assert.deepEqual(['active', 'inactive', 'cancelled'].map(status => altocContractStatusLabels[status]), ['有效', '已停用', '已取消'])
  const choices = altocBusinessObjectOptions([{ id: 1, quotation_no: 'QU-1', status: 'approved' }, { id: 2, quotation_no: 'QU-2', status: 'accepted' }, { id: 3, quotation_no: 'QU-3', status: 'draft' }], 'quotes')
  assert.deepEqual(choices.map(row => [row.value, row.disabled]), [['1', false], ['2', false], ['3', true]])
  assert.equal(choices[0].label, 'QU-1')
  assert.throws(() => requireAltocJsonMutationResult('<html>SPA</html>'), /沿用同一请求重试/)
  assert.deepEqual(requireAltocJsonMutationResult({ code: 0, data: { submitted: true } }), { code: 0, data: { submitted: true } })
})

test('contract and selector complete SFCs compile with server search, pagination and explicit states', () => {
  for (const name of ['AltocContractsPage.vue', 'AltocBusinessObjectSelect.vue']) {
    const source = readFileSync(new URL('../app/components/' + name, import.meta.url), 'utf8')
    const { descriptor, errors } = parse(source)
    assert.deepEqual(errors, [])
    const script = compileScript(descriptor, { id: name })
    assert.deepEqual(compileTemplate({ source: descriptor.template.content, filename: name, id: name, compilerOptions: { bindingMetadata: script.bindings } }).errors, [])
  }
  const selector = readFileSync(new URL('../app/components/AltocBusinessObjectSelect.vue', import.meta.url), 'utf8')
  for (const fact of ['useDebouncedSearch', 'pageSize: 20', 'ignore-filter', 'RemoteObjectSelectMenu', ':has-more="hasMore"', '@load-more="load(true)"', '没有查看', '权限加载失败']) assert.ok(selector.includes(fact), fact)
  const page = readFileSync(new URL('../app/components/AltocContractsPage.vue', import.meta.url), 'utf8')
  assert.match(page, /v-model="draft.quotationId"\s+kind="quotes"/)
  assert.match(page, /requireAltocJsonMutationResult\(await \$fetch/)
})

test('selector actual loader rejects stale replies, checks permission and ends loading on failures', async () => {
  const source = readFileSync(new URL('../app/components/AltocBusinessObjectSelect.vue', import.meta.url), 'utf8')
  const program = ts.createSourceFile('select.ts', parse(source).descriptor.scriptSetup.content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const load = program.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'load')
  const compiled = ts.transpileModule('let epoch = 0;\n' + load.getText(program) + '\nexport { load }', { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
  const calls = [], allowed = { value: false }, scope = { value: 'S1' }, options = { value: [] }, loading = { value: false }, error = { value: '' }
  const exports = {}
  runInNewContext(compiled, { exports, props: { kind: 'quotes', enabled: true }, allowed, scope, accessStatus: { value: 'ready' }, options, hasMore: { value: false }, loading, error, page: { value: 1 }, debounced: { value: 'QU' }, spec: { value: apfObjectSpecs.quotes }, apfChoicePage, apfChoiceOptions, $fetch: (url, opts) => new Promise((resolve, reject) => calls.push({ url, opts, resolve, reject })) })
  await exports.load()
  assert.equal(calls.length, 0)
  allowed.value = true
  const first = exports.load()
  assert.equal(calls[0].url, '/altoc/api/v1/quotes')
  assert.equal(calls[0].opts.query.search, 'QU')
  scope.value = ''
  await exports.load()
  calls[0].resolve({ data: { items: [{ id: 1, quotation_no: 'QU-1', status: 'approved' }], total: 1 } })
  await first
  assert.equal(options.value.length, 0)
  scope.value = 'S2'
  const failed = exports.load()
  calls[1].reject(Error('transport'))
  await failed
  assert.equal(loading.value, false)
  assert.match(error.value, /加载失败/)
})

test('every owning billing schedule status has a Chinese label', () => {
  const schema = readFileSync(new URL('../../altoc/docs/apf_m1_schema.sql', import.meta.url), 'utf8')
  const statuses = schema.match(/COMMENT 'planned\/billable\/invoicing[^']*'/)[0].slice(9, -1).split('/')
  const runtime = readFileSync(new URL('../../data-runtime/internal/apps/altoc/finance_billing_summary.go', import.meta.url), 'utf8')
  const emitted = [...runtime.matchAll(/(?:THEN|ELSE) '([^']+)'/g)].map(match => match[1])
  for (const status of new Set([...statuses, ...emitted, 'partially_invoiced', 'paid'])) {
    assert.match(altocContractStatusLabels[status] || '', /[\u4e00-\u9fff]/, status)
  }
  assert.equal(altocContractStatusLabels.received, '已到账')
  assert.equal(altocContractStatusLabels.partially_received, '部分到账')
})
