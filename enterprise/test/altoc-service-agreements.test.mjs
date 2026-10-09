import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'

test('Service agreements use fourteen fixed U operations and contract view/edit only', async () => {
  globalThis.__services = { allowed: true, query: { page: '2', pageSize: '20' }, params: {}, body: {}, calls: [] }
  const hooks = registerHooks({ resolve(specifier, context, next) {
    let source
    if (specifier === 'h3') source = `export const createError=x=>Object.assign(Error('fixed'),x);export const getHeader=()=> 'stable-key';export const getQuery=()=>globalThis.__services.query;export const getRouterParam=(e,k)=>globalThis.__services.params[k];export const readBody=async()=>globalThis.__services.body;export const setHeader=()=>{}`
    if (specifier.endsWith('/enterpriseRuntimeClient')) source = `export const requireEnterpriseUser=async()=>({uid:'Person',tenant:'C000001',deployment:'Host'});export const prepareEnterpriseRuntime=async()=>true;export const callEnterpriseRuntime=async(...args)=>{globalThis.__services.calls.push(args);return{code:0,data:args[1].endsWith('-page')?{items:[],total:0}:{id:'1'}}}`
    if (specifier === '../../shared/altoc-service-agreements') return next(specifier + '.ts', context)
    if (specifier === './enterpriseAPF') source = `export const buildAPFPermit=async(e,d,o,i,u,r,a)=>{if(!globalThis.__services.allowed)throw Object.assign(Error('fixed'),{statusCode:403});return {resource:r,action:a||'view',objectId:i.id,allowed:true}}`
    if (source) return { url: 'data:text/javascript,' + encodeURIComponent(source), shortCircuit: true }
    return next(specifier, context)
  } })
  try {
    const { enterpriseAltocServiceAgreements, normalizeServiceAgreementPayload } = await import('../server/utils/enterpriseAltocServiceAgreements.ts')
    await enterpriseAltocServiceAgreements({}, 'service-agreements-page')
    const read = globalThis.__services.calls[0]
    assert.equal(read[2].authorization.resource, 'contract')
    assert.equal(read[2].authorization.action, 'view')
    assert.equal(read[2].sales.payload.page, 2)
    globalThis.__services.query = {}
    globalThis.__services.body = { name: '标记服务', contract_id: '1' }
    await enterpriseAltocServiceAgreements({}, 'service-agreements-create')
    const write = globalThis.__services.calls[1]
    assert.equal(write[2].authorization.resource, 'contract')
    assert.equal(write[2].authorization.action, 'edit')
    assert.equal(write[3].idempotencyKey, 'stable-key')
    assert.equal(write[2].sales.payload.source_app, undefined)
    globalThis.__services.allowed = false
    await assert.rejects(enterpriseAltocServiceAgreements({}, 'service-agreements-create'), { statusCode: 403 })
    assert.equal(globalThis.__services.calls.length, 2)
    assert.throws(() => normalizeServiceAgreementPayload('service-agreements-create', { name: 'x', contract_id: '1', actor: 'forged' }), { statusCode: 400 })
    assert.throws(() => normalizeServiceAgreementPayload('service-agreements-update', { expectedVersion: 0 }), { statusCode: 400 })
    assert.throws(() => normalizeServiceAgreementPayload('service-agreements-page', { pageSize: 101 }), { statusCode: 400 })
    assert.throws(() => normalizeServiceAgreementPayload('service-agreements-view', { scope: 'all' }), { statusCode: 400 })
  } finally {
    hooks.deregister()
    delete globalThis.__services
  }
})

test('Service agreement grouped page compiles and uses scoped UI and stable intent', () => {
  const source = readFileSync(new URL('../app/components/AltocServiceAgreementsPage.vue', import.meta.url), 'utf8')
  const { descriptor, errors } = parse(source)
  assert.deepEqual(errors, [])
  const script = compileScript(descriptor, { id: 'services' })
  const template = compileTemplate({ source: descriptor.template.content, filename: 'AltocServiceAgreementsPage.vue', id: 'services', compilerOptions: { bindingMetadata: script.bindings } })
  assert.deepEqual(template.errors, [])
  for (const fact of ['hasPermission(\'contract\', \'edit\')', 'loadPermissions()', '权限信息加载失败', 'ContentPageHeader', 'useDebouncedSearch', ':loading="busy"', ':total="total"', '共 {{ total }} 条', ':total="coverageTotal"', ':total="projectTotal"', 'CommonEmptyState', 'intent.submit', 'expectedVersion', 'UserTreeSelector', 'useConfirm()', 'tone: \'warning\'', 'description=', 'overflow-x-auto', 'grid-cols-1', 'md:grid-cols-2']) assert.ok(source.includes(fact), fact)
  assert.ok(!source.includes('confirm-legacy'))
  const routes = readFileSync(new URL('../composition/business-api-routes.generated.mjs', import.meta.url), 'utf8')
  assert.ok(routes.includes('/altoc/api/v1/service-agreements/:agreementId/projects/:childId/set-default'))
})
