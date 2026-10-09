import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { ref, computed } from 'vue'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'

test('Tenders use ten fixed U operations and opportunity view/edit only', async () => {
  globalThis.__tenders = { allowed: true, query: { page: '2', pageSize: '20' }, params: {}, body: {}, calls: [] }
  const hooks = registerHooks({ resolve(specifier, context, next) {
    let source
    if (specifier === 'h3') source = `export const createError=x=>Object.assign(Error('fixed'),x);export const getHeader=()=> 'stable-key';export const getQuery=()=>globalThis.__tenders.query;export const getRouterParam=(e,k)=>globalThis.__tenders.params[k];export const readBody=async()=>globalThis.__tenders.body;export const setHeader=()=>{}`
    if (specifier.endsWith('/enterpriseRuntimeClient')) source = `export const requireEnterpriseUser=async()=>({uid:'Person',tenant:'C000001',deployment:'Host'});export const prepareEnterpriseRuntime=async()=>true;export const callEnterpriseRuntime=async(...args)=>{globalThis.__tenders.calls.push(args);return{code:0,data:args[1].endsWith('-page')?{items:[],total:0}:{id:'1'}}}`
    if (specifier === '../../shared/altoc-tenders') return next(specifier + '.ts', context)
    if (specifier === './enterpriseAPF') source = `export const buildAPFPermit=async(e,d,o,i,u,r,a)=>{if(!globalThis.__tenders.allowed)throw Object.assign(Error('fixed'),{statusCode:403});return {resource:r,action:a||'view',objectId:i.id,allowed:true}}`
    if (source) return { url: 'data:text/javascript,' + encodeURIComponent(source), shortCircuit: true }
    return next(specifier, context)
  } })
  try {
    const { enterpriseAltocTenders, normalizeTenderPayload } = await import('../server/utils/enterpriseAltocTenders.ts')
    await enterpriseAltocTenders({}, 'tenders-page')
    const read = globalThis.__tenders.calls[0]
    assert.equal(read[2].authorization.resource, 'opportunity')
    assert.equal(read[2].authorization.action, 'view')
    assert.equal(read[2].sales.payload.page, 2)
    globalThis.__tenders.query = {}
    globalThis.__tenders.body = { name: '手工标记投标', owner_uid: 'Person' }
    await enterpriseAltocTenders({}, 'tenders-create')
    const write = globalThis.__tenders.calls[1]
    assert.equal(write[2].authorization.resource, 'opportunity')
    assert.equal(write[2].authorization.action, 'edit')
    assert.equal(write[3].idempotencyKey, 'stable-key')
    assert.equal(write[2].sales.payload.opportunity_id, undefined)
    globalThis.__tenders.allowed = false
    await assert.rejects(enterpriseAltocTenders({}, 'tenders-create'), { statusCode: 403 })
    assert.equal(globalThis.__tenders.calls.length, 2)
    assert.throws(() => normalizeTenderPayload('tenders-create', { name: 'x', owner_uid: 'x', actor: 'forged' }), { statusCode: 400 })
    assert.throws(() => normalizeTenderPayload('tenders-update', { expectedVersion: 0 }), { statusCode: 400 })
    assert.throws(() => normalizeTenderPayload('tenders-page', { pageSize: 101 }), { statusCode: 400 })
    assert.throws(() => normalizeTenderPayload('tenders-view', { scope: 'all' }), { statusCode: 400 })
  } finally {
    hooks.deregister()
    delete globalThis.__tenders
  }
})

test('Tender page compiles with responsive grouped form, stable intents and real pagination', () => {
  const source = readFileSync(new URL('../app/components/AltocTendersPage.vue', import.meta.url), 'utf8')
  const { descriptor, errors } = parse(source)
  assert.deepEqual(errors, [])
  const script = compileScript(descriptor, { id: 'tender' })
  const template = compileTemplate({ source: descriptor.template.content, filename: 'AltocTendersPage.vue', id: 'tender', compilerOptions: { bindingMetadata: script.bindings } })
  assert.deepEqual(template.errors, [])
  for (const fact of ['hasPermission(\'opportunity\', \'edit\')', 'loadPermissions()', '权限信息加载失败', 'ContentPageHeader', 'useDebouncedSearch', ':loading="busy"', ':total="total"', '共 {{ total }} 条', 'CommonEmptyState', 'intent.submit', 'expectedVersion', 'UserTreeSelector', 'APFDepartmentSelect', 'useConfirm()', 'tone: \'danger\'', 'description=', 'overflow-x-auto', 'grid-cols-1', 'md:grid-cols-2']) assert.ok(source.includes(fact), fact)
  assert.ok(!source.includes('hasPermission(\'tender\''))
})

test('Ten tender routes are registered and topology admits only their exact methods', async () => {
  const { businessApiRoutes } = await import('../composition/business-api-routes.generated.mjs')
  const { resolveEnterprisePilotPath } = await import('../../deploy/test-env/enterprise-topology.mjs')
  const routes = [['GET', '/altoc/api/v1/tenders'], ['POST', '/altoc/api/v1/tenders'], ['GET', '/altoc/api/v1/tenders/:tenderId'], ['PATCH', '/altoc/api/v1/tenders/:tenderId'], ['GET', '/altoc/api/v1/tenders/agencies'], ['POST', '/altoc/api/v1/tenders/agencies'], ['POST', '/altoc/api/v1/tenders/:tenderId/members'], ['DELETE', '/altoc/api/v1/tenders/:tenderId/members/:childId'], ['POST', '/altoc/api/v1/tenders/:tenderId/milestones'], ['PATCH', '/altoc/api/v1/tenders/:tenderId/milestones/:childId']]
  for (const [method, path] of routes) assert.ok(businessApiRoutes.some(r => r[0] === method && r[1] === path), `${method} ${path}`)
  for (const [method, path] of routes) {
    const actual = path.replace(':tenderId', '1').replace(':childId', '2')
    assert.equal(resolveEnterprisePilotPath(actual, '', method).kind, 'api')
    assert.equal(resolveEnterprisePilotPath(actual + '/extra', '', method).kind, 'unavailable')
  }
  assert.equal(resolveEnterprisePilotPath('/altoc/api/v1/tenders/1', '', 'DELETE').kind, 'unavailable')
  assert.equal(routes.length, 10)
})

test('optional B5 unavailable renders a feature explanation and suppresses empty/create state', async () => {
  const { tenderReadFailure } = await import('../shared/altoc-tender-availability.ts')
  for (const failure of [{ statusCode: 503 }, { status: 503 }, { response: { status: 503 } }]) {
    assert.deepEqual(tenderReadFailure(failure), { unavailable: true, message: '投标功能暂不可用，请联系管理员完成模块安装后重试。' })
  }
  assert.equal(tenderReadFailure({ statusCode: 403 }).unavailable, false)
  assert.equal(tenderReadFailure({ statusCode: 404 }).unavailable, false)
  const source = readFileSync(new URL('../app/components/AltocTendersPage.vue', import.meta.url), 'utf8')
  assert.match(source, /unavailable.value = state.unavailable/)
  assert.match(source, /canEdit && !unavailable && mode === 'list'/)
  assert.match(source, /mode === 'list' && canRead && !error/)
})

test('actual tender page read keeps its header and ends loading when optional storage returns 503', async () => {
  const { tenderReadFailure } = await import('../shared/altoc-tender-availability.ts')
  const { descriptor } = parse(readFileSync(new URL('../app/components/AltocTendersPage.vue', import.meta.url), 'utf8'))
  const script = descriptor.scriptSetup.content.split('watch([id, scope, accessStatus')[0].replace(/^import.*$/gm, '')
  let fail = true
  const context = {
    ref, computed, tenderReadFailure,
    defineProps: () => ({ mode: 'list' }),
    useRoute: () => ({ params: {} }),
    useAuth: () => ({ user: ref('reader') }),
    usePermissions: () => ({ loaded: ref(true), error: ref(''), hasPermission: () => true, loadPermissions: async () => {} }),
    onMounted: () => {},
    useState: () => ref('session'),
    useEnterpriseNavigationAccess: () => ({ status: ref('ready') }),
    useDebouncedSearch: () => ({ search: ref(''), debounced: ref(''), flush: () => {} }),
    useAltocDirectoryLabels: () => ({}),
    $fetch: async () => {
      if (fail) throw { statusCode: 503 }
      return { data: { items: [], total: 0 } }
    }
  }
  runInNewContext(ts.transpileModule(script + '\nglobalThis.state = { load, busy, unavailable, error, rows };', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context)
  await context.state.load()
  assert.equal(context.state.busy.value, false)
  assert.equal(context.state.unavailable.value, true)
  assert.match(context.state.error.value, /功能暂不可用/)
  assert.equal(context.state.rows.value.length, 0)
  fail = false
  await context.state.load()
  assert.equal(context.state.busy.value, false)
  assert.equal(context.state.unavailable.value, false)
  assert.equal(context.state.error.value, '')
})
