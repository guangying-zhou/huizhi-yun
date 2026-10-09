import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'

test('Sales fixed operations preserve each personnel action and signed intent', async () => {
  globalThis.__sales = { id: '1', allowed: true, calls: [], body: { owner_uid: 'Person', expectedVersion: 1 } }
  const hooks = registerHooks({ resolve(specifier, context, next) {
    let source
    if (specifier === 'h3') source = `export const createError=x=>Object.assign(Error('fixed'),x);export const getHeader=()=> 'stable-key';export const getQuery=()=>({});export const getRouterParam=()=>globalThis.__sales.id;export const readBody=async()=>globalThis.__sales.body;export const setHeader=()=>{}`
    if (specifier.endsWith('/enterpriseRuntimeClient')) source = `export const requireEnterpriseUser=async()=>({uid:'Person',tenant:'C000001',deployment:'Host'});export const prepareEnterpriseRuntime=async()=>true;export const callEnterpriseRuntime=async(...args)=>{globalThis.__sales.calls.push(args);return{code:0,data:{data:{id:1,row_version:2,owner_uid:'Person'}}}}`
    if (specifier === './enterpriseAPF') source = `export const buildAPFPermit=async(e,d,o,i,u,r,a)=>{if(!globalThis.__sales.allowed)throw Object.assign(Error('fixed'),{statusCode:403});return {resource:r,action:a,objectId:i.id,allowed:true}}`
    if (specifier === '../../shared/altoc-basic-read') return { url: new URL('../shared/altoc-basic-read.ts', import.meta.url).href, shortCircuit: true }
    if (source) return { url: 'data:text/javascript,' + encodeURIComponent(source), shortCircuit: true }
    return next(specifier, context)
  } })
  try {
    const { enterpriseAltocSales, salesOperations } = await import('../server/utils/enterpriseAltocSales.ts')
    assert.equal(Object.keys(salesOperations).length, 15)
    await enterpriseAltocSales({}, 'leads-assign')
    const c = globalThis.__sales.calls[0]
    assert.equal(c[1], 'altoc.apf07-leads-assign')
    assert.equal(c[2].authorization.action, 'assign')
    assert.equal(c[2].authorization.resource, 'lead')
    assert.equal(c[2].sales.payload.expectedVersion, 1)
    assert.equal(c[3].idempotencyKey, 'stable-key')
    globalThis.__sales.allowed = false
    await assert.rejects(enterpriseAltocSales({}, 'leads-assign'), { statusCode: 403 })
    assert.equal(globalThis.__sales.calls.length, 1)
    globalThis.__sales.body.status = 'won'
    await assert.rejects(enterpriseAltocSales({}, 'leads-assign'), { statusCode: 400 })
  } finally {
    hooks.deregister()
    delete globalThis.__sales
  }
})
test('Sales pages compile, load permissions and retain grouped responsive guarded forms', () => {
  const source = readFileSync(new URL('../app/components/AltocSalesPage.vue', import.meta.url), 'utf8')
  const { descriptor, errors } = parse(source)
  assert.deepEqual(errors, [])
  const script = compileScript(descriptor, { id: 'sales' })
  const template = compileTemplate({ source: descriptor.template.content, filename: 'AltocSalesPage.vue', id: 'sales', compilerOptions: { bindingMetadata: script.bindings } })
  assert.deepEqual(template.errors, [])
  for (const fact of ['loadPermissions()', 'hasPermission(props.resource, action)', '权限信息加载失败', 'ContentPageHeader', 'useDebouncedSearch', ':loading="loading"', 'CommonEmptyState', ':total="total"', '共 {{ total }} 条', 'expectedVersion', 'intent.submit', 'USlideover', 'UserTreeSelector', 'APFDepartmentSelect', 'useConfirm', 'description='])assert.ok(source.includes(fact), fact)
})

test('All fifteen UI write URLs have a matching literal Host registration', async () => {
  const { businessApiRoutes } = await import('../composition/business-api-routes.generated.mjs')
  for (const [group, actions] of [['leads', ['assign', 'convert', 'disqualify', 'activity']], ['opportunities', ['assign', 'transition', 'close-won', 'close-lost', 'pause', 'reopen', 'activity']]]) {
    const id = group === 'leads' ? 'leadId' : 'opportunityId'
    const base = `/altoc/api/v1/${group}`
    for (const [method, path] of [['POST', base], ['PATCH', `${base}/:${id}`], ...actions.map(a => ['POST', `${base}/:${id}/${a}`])]) assert.ok(businessApiRoutes.some(r => r[0] === method && r[1] === path), `${method} ${path}`)
  }
})
