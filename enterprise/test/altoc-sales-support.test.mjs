import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'

test('Sales support uses fourteen closed operations, parent-bound permit and exact action', async () => {
  globalThis.__support = { allowed: true, query: { page: '2', pageSize: '20' }, params: { opportunityId: '10' }, body: {}, calls: [] }
  const hooks = registerHooks({ resolve(specifier, context, next) {
    let source
    if (specifier === 'h3')
      source = `export const createError=x=>Object.assign(Error('fixed'),x);export const getHeader=()=> 'stable-key';export const getQuery=()=>globalThis.__support.query;export const getRouterParam=(e,k)=>globalThis.__support.params[k];export const readBody=async()=>globalThis.__support.body;export const setHeader=()=>{}`
    if (specifier.endsWith('/enterpriseRuntimeClient'))
      source = `export const requireEnterpriseUser=async()=>({uid:'Person',tenant:'C000001',deployment:'Host'});export const prepareEnterpriseRuntime=async()=>true;export const callEnterpriseRuntime=async(...args)=>{globalThis.__support.calls.push(args);return{code:0,data:args[1].endsWith('-list')?{items:[],total:0}:{childId:'1',parentVersion:'2'}}}`
    if (specifier === './enterpriseAPF')
      source = `export const buildAPFPermit=async(e,d,o,i,u,r,a)=>{if(!globalThis.__support.allowed)throw Object.assign(Error('fixed'),{statusCode:403});return {resource:r,action:a||'view',objectId:i.id,allowed:true}}`
    if (source)
      return { url: 'data:text/javascript,' + encodeURIComponent(source), shortCircuit: true }
    return next(specifier, context)
  } })
  try {
    const { enterpriseAltocSalesSupport, supportOperations, normalizeSalesSupport } = await import('../server/utils/enterpriseAltocSalesSupport.ts')
    assert.equal(supportOperations.length, 14)
    await enterpriseAltocSalesSupport({}, 'opportunity-contact-roles-list')
    assert.equal(globalThis.__support.calls[0][2].authorization.objectId, '10')
    assert.equal(globalThis.__support.calls[0][2].sales.payload.page, 2)
    globalThis.__support.query = { purpose: 'lead-convert' }
    await enterpriseAltocSalesSupport({}, 'opportunity-stages-list')
    const config = globalThis.__support.calls[1][2]
    assert.equal(config.authorization.resource, 'lead')
    assert.equal(config.authorization.action, 'convert')
    globalThis.__support.allowed = false
    await assert.rejects(enterpriseAltocSalesSupport({}, 'opportunity-stages-list'), { statusCode: 403 })
    assert.equal(globalThis.__support.calls.length, 2)
    globalThis.__support.allowed = true
    globalThis.__support.query = {}
    globalThis.__support.params.childId = '99'
    globalThis.__support.body = { expectedVersion: 5 }
    await enterpriseAltocSalesSupport({}, 'opportunity-documents-delete')
    const write = globalThis.__support.calls[2]
    assert.equal(write[2].sales.payload.childId, '99')
    assert.equal(write[2].authorization.action, 'edit')
    assert.equal(write[3].idempotencyKey, 'stable-key')
    assert.throws(() => normalizeSalesSupport('opportunity-documents-create', { expectedVersion: 1, acl: true }), { statusCode: 400 })
    assert.throws(() => normalizeSalesSupport('lead-activities-list', { pageSize: 101 }), { statusCode: 400 })
    globalThis.__support.body.childId = '100'
    await assert.rejects(enterpriseAltocSalesSupport({}, 'opportunity-documents-delete'), { statusCode: 400 })
  } finally {
    hooks.deregister()
    delete globalThis.__support
  }
})

test('Support page compiles and preserves guarded responsive interactions and server pagination', () => {
  const source = readFileSync(new URL('../app/components/AltocSalesSupport.vue', import.meta.url), 'utf8')
  const { descriptor, errors } = parse(source)
  assert.deepEqual(errors, [])
  const script = compileScript(descriptor, { id: 'support' })
  const template = compileTemplate({ source: descriptor.template.content, filename: 'AltocSalesSupport.vue', id: 'support', compilerOptions: { bindingMetadata: script.bindings } })
  assert.deepEqual(template.errors, [])
  for (const fact of [':loading="loading"', 'CommonEmptyState', ':total="total"', '共 {{ total }} 条', 'expectedVersion: props.version', 'intent.submit', 'useConfirm()', 'description=', 'overflow-x-auto', '!props.canEdit', 'epoch++'])
    assert.ok(source.includes(fact), fact)
  const parent = readFileSync(new URL('../app/components/AltocSalesPage.vue', import.meta.url), 'utf8')
  assert.ok(parent.includes('AltocSalesSupport'))
  assert.ok(parent.includes(':can-edit="can(\'edit\')"'))
})

test('Fourteen literal support BFFs are registered including child methods', async () => {
  const { businessApiRoutes } = await import('../composition/business-api-routes.generated.mjs')
  const routes = [['GET', '/altoc/api/v1/config/opportunity-stages']]
  for (const [plural, id] of [['leads', 'leadId'], ['opportunities', 'opportunityId']]) {
    const root = `/altoc/api/v1/${plural}/:${id}`
    routes.push(['GET', `${root}/activities`], ['GET', `${root}/documents`], ['POST', `${root}/documents`], ['DELETE', `${root}/documents/:childId`])
    if (plural === 'opportunities')
      routes.push(['GET', `${root}/stage-history`], ['GET', `${root}/contact-roles`], ['POST', `${root}/contact-roles`], ['PATCH', `${root}/contact-roles/:childId`], ['DELETE', `${root}/contact-roles/:childId`])
  }
  assert.equal(routes.length, 14)
  for (const [method, path] of routes)
    assert.ok(businessApiRoutes.some(r => r[0] === method && r[1] === path), `${method} ${path}`)
})
