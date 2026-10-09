import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'

const read = p => readFileSync(new URL(p, import.meta.url), 'utf8')

test('B5-A whole page and embedded tabs compile, no hidden permission or unpaged list', () => {
  for (const name of ['AltocReceivablesPage', 'AltocCustomersPage', 'AltocContractsPage']) {
    const source = read(`../app/components/${name}.vue`)
    const { descriptor, errors } = parse(source)
    assert.deepEqual(errors, [])
    const script = compileScript(descriptor, { id: name })
    const template = compileTemplate({ source: descriptor.template.content, filename: name, id: name, compilerOptions: { bindingMetadata: script.bindings } })
    assert.deepEqual(template.errors, [])
  }
  const source = read('../app/components/AltocReceivablesPage.vue')
  for (const token of ['CommonEmptyState', 'ContentPageHeader', 'UserTreeSelector', 'useDebouncedSearch', 'loadPermissions()', 'hasPermission(\'receivable\', \'assign\')', 'hasPermission(\'receivable\', \'set-due-date\')', 'hasPermission(\'receivable\', \'followup\')', 'Idempotency-Key', 'createConsoleMutationIntent', 'expectedVersion', ':loading="loading"', 'UPagination', '共 {{ total }} 条', 'historical_not_ready_count', '非实际收款', 'await load()', 'draft', 'useConfirm()']) assert.ok(source.includes(token), token)
  assert.ok(!/\b(?:alert|prompt)\(/.test(source))
  assert.ok(!/label: '全部[^']*', value: ''/.test(source), 'Nuxt UI Select items never have empty values')
  assert.match(read('../app/pages/altoc/payments/index.vue'), /import SettlementWorkspace/)
  assert.match(read('../app/pages/altoc/payments/[planId].vue'), /import AltocReceivablesPage/)
})

test('B5-A exact fixed paths share runtime and Host closed sets and manifest sensitive actions', () => {
  const runtime = read('../../data-runtime/internal/server/enterprise_apf.go')
  const host = read('../../foundation/server/utils/enterpriseRuntimeClient.ts')
  const manifest = JSON.parse(read('../../altoc/app.manifest.json'))
  const resource = manifest.resources.find(r => r.code === 'receivable')
  for (const action of ['assign', 'set-due-date', 'followup']) {
    assert.ok(resource.actions.includes(action))
    assert.deepEqual(manifest.recommendedRoles.filter(r => r.suggestedPermissions.includes(`altoc:receivable:${action}`)).map(r => r.code).sort(), ['altoc:admin', 'altoc:contract_manager'])
  }
  for (const path of ['page', 'detail', 'aging-summary', 'set-collection-owner', 'set-due-date', 'followup-create']) {
    assert.ok(runtime.includes(`/v1/enterprise/altoc/receivables:${path}`))
    assert.ok(host.includes(`/v1/enterprise/altoc/receivables:${path}`))
  }
})

test('real receivable BFF binds filters, signed exact sensitive action and idempotency and rejects untrusted authority', async () => {
  globalThis.__receivable = { query: { page: '2', pageSize: '20', agingBucket: '1_30' }, id: '', key: 'stable-key', body: {}, calls: [] }
  const hooks = registerHooks({ resolve(specifier, context, next) {
    let source
    if (specifier === '../../shared/altoc-receivables') return next(specifier + '.ts', context)
    if (specifier === 'h3') source = `export const createError=x=>Object.assign(Error('fixed'),x);export const getHeader=()=>globalThis.__receivable.key;export const getQuery=()=>globalThis.__receivable.query;export const getRouterParam=()=>globalThis.__receivable.id;export const readBody=async()=>globalThis.__receivable.body;export const setHeader=()=>{}`
    if (specifier.endsWith('/enterpriseRuntimeClient')) source = `export const requireEnterpriseUser=async()=>({uid:'actor',tenant:'C000001',deployment:'host'});export const prepareEnterpriseRuntime=async()=>{};export const callEnterpriseRuntime=async(...args)=>{globalThis.__receivable.calls.push(args);const payload=args[2].sales.payload;return {code:0,data:args[2].sales.id?{id:args[2].sales.id,row_version:2}:{items:[],totals:[],total:0,page:payload.page,pageSize:payload.pageSize}}}`
    if (specifier.endsWith('enterpriseAPF')) source = `export const buildAPFPermit=async(...args)=>{globalThis.__receivable.authority=args.slice(-2);return {resource:'receivable',action:args.at(-1)||'view',bundleVersion:'v1',bundleHash:'hash',policyRevision:1,expiresAt:Date.now()+30000}}`
    if (specifier.endsWith('/platformBundleAuthorization')) source = `export const loadScopedAuthorizationFromConsoleRuntime=async()=>globalThis.__receivable.bank`
    if (specifier.endsWith('/scopeEvaluator')) source = `export const evaluateFoundationScopedAuthorization=()=>({allowed:Boolean(globalThis.__receivable.bank?.allowed)})`
    if (source) return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true }
    return next(specifier, context)
  } })
  try {
    const { enterpriseAltocReceivables, normalizeReceivablePayload } = await import('../server/utils/enterpriseAltocReceivables.ts')
    await enterpriseAltocReceivables({}, 'receivables-page')
    assert.deepEqual(globalThis.__receivable.calls[0][2].sales.payload, { page: 2, pageSize: 20, agingBucket: '1_30' })
    globalThis.__receivable.query = {}
    globalThis.__receivable.id = '1'
    globalThis.__receivable.body = { expectedVersion: 1, collection_responsible_uid: 'collector' }
    await enterpriseAltocReceivables({}, 'receivables-set-collection-owner')
    assert.deepEqual(globalThis.__receivable.authority, ['receivable', 'assign'])
    assert.equal(globalThis.__receivable.calls[1][3].idempotencyKey, 'stable-key')
    globalThis.__receivable.key = ''
    await assert.rejects(enterpriseAltocReceivables({}, 'receivables-set-collection-owner'), { statusCode: 400 })
    for (const bad of [{ actor: 'forged' }, { legalEntityRead: true }, { scope: 'all' }, { pageSize: 101 }]) assert.throws(() => normalizeReceivablePayload('receivables-page', bad), { statusCode: 400 })
    assert.equal(globalThis.__receivable.calls.length, 2)
    globalThis.__receivable.id = ''
    globalThis.__receivable.query = { legalEntityCode: 'LE-SYNTHETIC' }
    globalThis.__receivable.bank = { uid: 'actor', appCode: 'finance', bundleVersion: 'v1', bundleHash: 'hash', policyRevision: 1, authorizationExpiresAt: Date.now() + 20000, grants: [], allowed: false }
    await assert.rejects(enterpriseAltocReceivables({}, 'receivables-page'), { statusCode: 403 })
    assert.equal(globalThis.__receivable.calls.length, 2, 'joint Finance denial happens before Runtime read')
    globalThis.__receivable.bank.allowed = true
    globalThis.__receivable.bank.uid = 'other'
    await assert.rejects(enterpriseAltocReceivables({}, 'receivables-page'), { statusCode: 503 })
    globalThis.__receivable.bank.uid = 'actor'
    await enterpriseAltocReceivables({}, 'receivables-page')
    assert.equal(globalThis.__receivable.calls.at(-1)[2].sales.payload.legalEntityRead, true)
    assert.equal(globalThis.__receivable.calls.at(-1)[2].authorization.expiresAt, globalThis.__receivable.bank.authorizationExpiresAt)
  } finally {
    hooks.deregister()
    delete globalThis.__receivable
  }
})

test('collection history shows known before/after changes without raw or unknown fields', async () => {
  const { receivableEventChanges } = await import('../shared/altoc-receivables.ts')
  assert.deepEqual(receivableEventChanges({ before_json: '{"due_date":"2026-01-01"}', after_json: '{"due_date":null,"secret":"hidden"}' }), ['到期日：2026-01-01 → 未设置'])
  assert.deepEqual(receivableEventChanges({ before_json: 'broken', after_json: '[]' }), [])
})

test('saved receivable views whitelist columns and never persist business filters or payload', async () => {
  const { receivableColumnPreference } = await import('../shared/altoc-receivables.ts')
  assert.deepEqual(receivableColumnPreference(['due_date', 'secret', 'due_date']), ['due_date'])
  assert.deepEqual(receivableColumnPreference([]), [])
  assert.ok(receivableColumnPreference(null).length > 0)
})

test('actual component retains retry key and draft, refreshes CAS conflicts and drills exact currency', async () => {
  const { build } = await import('esbuild')
  const { createRequire } = await import('node:module')
  const ts = createRequire(import.meta.url)('typescript')
  const vue = await import('vue')
  const presentation = await import('../app/utils/altocBusinessObjectPresentation.ts')
  const shared = await import('../shared/altoc-receivables.ts')
  const built = await build({ entryPoints: [new URL('../../foundation/shared/utils/consoleMutationIntent.ts', import.meta.url).pathname], bundle: true, format: 'cjs', platform: 'node', write: false })
  const module = { exports: {} }
  new Function('module', 'exports', built.outputFiles[0].text)(module, module.exports)
  const source = parse(read('../app/components/AltocReceivablesPage.vue')).descriptor.scriptSetup.content
  const program = ts.createSourceFile('receivables.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const script = program.statements.filter(node => !ts.isImportDeclaration(node)).map(node => node.getText(program)).join('\n').replaceAll('import.meta.client', 'false')
  const code = ts.transpileModule(script + '\nreturn {save,openAction,draft,data,formOpen,formError,drill,page,currency,bucket,load}', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  const calls = [], toasts = []
  let failure = 'lost'
  const { ref, computed, watch, onScopeDispose, effectScope, nextTick } = vue
  const cache = ref('fixture-scope')
  const permission = ref(true)
  const context = {
    ...module.exports, ...shared, requireAltocJsonMutationResult: presentation.requireAltocJsonMutationResult, altocBillingScheduleStatusLabels: presentation.altocContractStatusLabels,
    defineEmits: () => () => {}, defineExpose: () => {},
    ref, computed, watch, onScopeDispose, onMounted: () => {}, defineProps: () => ({ detail: true }), useRoute: () => ({ params: { planId: '1' } }),
    usePermissions: () => ({ loaded: ref(true), error: ref(''), hasPermission: () => permission.value, loadPermissions: async () => {} }), useState: () => cache, useEnterpriseNavigationAccess: () => ({ status: ref('ready') }),
    useDebouncedSearch: () => ({ search: ref(''), debounced: ref(''), flush: () => {} }), formatMoney: String, useToast: () => ({ add: toast => toasts.push(toast) }), useConfirm: () => ({ confirm: async () => true }),
    $fetch: async (path, options) => {
      calls.push({ path, options })
      if (options.method === 'POST') {
        if (failure === 'lost') throw new TypeError('fetch failed')
        if (failure === 'conflict') throw Object.assign(Error('conflict'), { statusCode: 409, data: { code: 'receivable_version_conflict' } })
        return { code: 0, data: { id: 1, row_version: 3 } }
      }
      return { code: 0, data: { id: 1, row_version: 2, name: '合成款项', financial_ready: true, collection_installed: true, status: 'billable' } }
    }
  }
  const scope = effectScope()
  const h = scope.run(() => new Function(...Object.keys(context), code)(...Object.values(context)))
  try {
    await nextTick()
    await h.load()
    h.openAction('followups')
    h.draft.value.result = '合成跟进内容'
    await h.save()
    assert.equal(h.formOpen.value, true)
    assert.equal(h.draft.value.result, '合成跟进内容')
    assert.match(h.formError.value, /保存结果未确认/)
    const key = calls.find(c => c.options.method === 'POST').options.headers['Idempotency-Key']
    failure = ''
    await h.save()
    const writes = calls.filter(c => c.options.method === 'POST')
    assert.equal(writes[1].options.headers['Idempotency-Key'], key)
    assert.equal(writes[1].options.body.expectedVersion, 2)
    assert.equal(h.formOpen.value, false)
    h.openAction('followups')
    h.draft.value.result = '版本冲突草稿'
    failure = 'conflict'
    const before = calls.length
    await h.save()
    assert.ok(calls.slice(before).some(c => !c.options.method))
    assert.equal(h.draft.value.result, '版本冲突草稿')
    assert.equal(h.formOpen.value, true)
    h.drill({ currency_code: 'USD', aging_bucket: '31_60' })
    assert.equal(h.currency.value, 'USD')
    assert.equal(h.bucket.value, '31_60')
    assert.ok(toasts.some(t => t.color === 'success'))
    cache.value = 'different-session'
    await nextTick()
    assert.equal(h.formOpen.value, false)
    assert.deepEqual(h.draft.value, {})
    permission.value = false
    await nextTick()
    const deniedCalls = calls.length
    await h.load()
    assert.equal(calls.length, deniedCalls)
    assert.equal(h.data.value, null)
  } finally { scope.stop() }
})

test('actual APF compiler rejects even broad admin implications and never widens an exact collection scope', async () => {
  const { build } = await import('esbuild')
  const { createRequire } = await import('node:module')
  const ts = createRequire(import.meta.url)('typescript')
  async function bundle(path) {
    const built = await build({ entryPoints: [new URL(path, import.meta.url).pathname], bundle: true, format: 'cjs', platform: 'node', write: false })
    const module = { exports: {} }
    new Function('module', 'exports', built.outputFiles[0].text)(module, module.exports)
    return module.exports
  }
  const evaluator = await bundle('../../foundation/server/utils/scopeEvaluator.ts')
  const compiler = await bundle('../../altoc/server/utils/altocDataAccessScope.ts')
  const program = ts.createSourceFile('APF.ts', read('../server/utils/enterpriseAPF.ts'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const script = program.statements.filter(node => !ts.isImportDeclaration(node)).map(node => node.getText(program)).join('\n').replace(/^export /gm, '')
  const code = ts.transpileModule(script + '\nreturn buildAPFPermit', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  const user = { uid: 'actor', tenant: 'C000001', deployment: 'host' }
  const triple = action => ({ appCode: 'altoc', resourceCode: 'receivable', action })
  const broad = { grantId: 'broad', permissions: [triple('admin')], defaultScopes: [{ dimension: 'tenant', predicate: 'global' }] }
  let authorization = { uid: 'actor', appCode: 'altoc', bundleVersion: 'v1', bundleHash: 'hash', policyRevision: 1, authorizationExpiresAt: Date.now() + 30000, roles: ['altoc:admin'], actionPolicy: { implications: { admin: ['*'] } }, grants: [broad] }
  const context = { ...evaluator, ...compiler, createError: value => Object.assign(Error('fixed'), value), loadScopedAuthorizationFromConsoleRuntime: async () => authorization, enterpriseRuntimePermitExpiresAt: () => Date.now() + 20000 }
  const permit = new Function(...Object.keys(context), code)(...Object.values(context))
  for (const action of ['assign', 'set-due-date', 'followup']) {
    await assert.rejects(permit({}, 'altoc', 'save', { id: '1' }, user, 'receivable', action), { statusCode: 403 })
    authorization = { ...authorization, roles: ['altoc:contract_manager'], grants: [broad, { grantId: 'exact', permissions: [triple(action)], defaultScopes: [{ dimension: 'subject', predicate: 'self' }] }] }
    const result = await permit({}, 'altoc', 'save', { id: '1' }, user, 'receivable', action)
    assert.equal(result.action, action)
    assert.equal(result.scope.access, 'self', 'unrelated implied admin grant must not widen the explicit action scope')
    assert.equal(authorization.grants.length, 2, 'cached Console snapshot stays untouched')
    authorization = { ...authorization, roles: ['altoc:admin'], grants: [broad] }
  }
})
