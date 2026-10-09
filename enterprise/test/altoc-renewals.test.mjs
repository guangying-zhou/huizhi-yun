import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'

test('Renewals use four fixed U operations and renewal view/edit only', async () => {
  globalThis.__services = { allowed: true, query: { page: '2', pageSize: '20' }, params: {}, body: {}, calls: [] }
  const hooks = registerHooks({ resolve(specifier, context, next) {
    let source
    if (specifier === 'h3') source = `export const createError=x=>Object.assign(Error('fixed'),x);export const getHeader=()=> 'stable-key';export const getQuery=()=>globalThis.__services.query;export const getRouterParam=(e,k)=>globalThis.__services.params[k];export const readBody=async()=>globalThis.__services.body;export const setHeader=()=>{}`
    if (specifier.endsWith('/enterpriseRuntimeClient')) source = `export const requireEnterpriseUser=async()=>({uid:'Person',tenant:'C000001',deployment:'Host'});export const prepareEnterpriseRuntime=async()=>true;export const callEnterpriseRuntime=async(...args)=>{globalThis.__services.calls.push(args);return{code:0,data:args[1].endsWith('-page')?{items:[],total:0}:{id:'1'}}}`
    if (specifier === '../../shared/altoc-renewals') return next(specifier + '.ts', context)
    if (specifier === './enterpriseAPF') source = `export const buildAPFPermit=async(e,d,o,i,u,r,a)=>{if(!globalThis.__services.allowed)throw Object.assign(Error('fixed'),{statusCode:403});return {resource:r,action:a||'view',objectId:i.id,allowed:true}}`
    if (source) return { url: 'data:text/javascript,' + encodeURIComponent(source), shortCircuit: true }
    return next(specifier, context)
  } })
  try {
    const { enterpriseAltocRenewals, normalizeRenewalPayload } = await import('../server/utils/enterpriseAltocRenewals.ts')
    await enterpriseAltocRenewals({}, 'renewals-page')
    const read = globalThis.__services.calls[0]
    assert.equal(read[2].authorization.resource, 'renewal_opportunity')
    assert.equal(read[2].authorization.action, 'view')
    assert.equal(read[2].sales.payload.page, 2)
    globalThis.__services.query = {}
    globalThis.__services.body = { name: '标记续约', customer_id: '1', contract_id: '1', owner_uid: 'Person' }
    await enterpriseAltocRenewals({}, 'renewals-create')
    const write = globalThis.__services.calls[1]
    assert.equal(write[2].authorization.resource, 'renewal_opportunity')
    assert.equal(write[2].authorization.action, 'edit')
    assert.equal(write[3].idempotencyKey, 'stable-key')
    assert.equal(write[2].sales.payload.source_app, undefined)
    globalThis.__services.allowed = false
    await assert.rejects(enterpriseAltocRenewals({}, 'renewals-create'), { statusCode: 403 })
    assert.equal(globalThis.__services.calls.length, 2)
    assert.throws(() => normalizeRenewalPayload('renewals-create', { name: 'x', customer_id: '1', owner_uid: 'Person', actor: 'forged' }), { statusCode: 400 })
    assert.throws(() => normalizeRenewalPayload('renewals-update', { expectedVersion: 0 }), { statusCode: 400 })
    assert.throws(() => normalizeRenewalPayload('renewals-page', { pageSize: 101 }), { statusCode: 400 })
    assert.throws(() => normalizeRenewalPayload('renewals-view', { scope: 'all' }), { statusCode: 400 })
  } finally {
    hooks.deregister()
    delete globalThis.__services
  }
})

test('Renewal grouped page compiles, pages server counts and never offers automatic extension', () => {
  const source = readFileSync(new URL('../app/components/AltocRenewalsPage.vue', import.meta.url), 'utf8')
  const { descriptor, errors } = parse(source)
  assert.deepEqual(errors, [])
  const script = compileScript(descriptor, { id: 'renewals' })
  const template = compileTemplate({ source: descriptor.template.content, filename: 'AltocRenewalsPage.vue', id: 'renewals', compilerOptions: { bindingMetadata: script.bindings } })
  assert.deepEqual(template.errors, [])
  for (const fact of ['hasPermission(\'renewal_opportunity\', \'edit\')', 'loadPermissions()', '权限信息加载失败', 'ContentPageHeader', 'useDebouncedSearch', ':loading="loading"', ':total="total"', '共 {{ total }} 条', 'CommonEmptyState', 'intent.submit', 'expectedVersion', 'UserTreeSelector', 'APFDepartmentSelect', 'overflow-x-auto', 'grid-cols-1', 'md:grid-cols-2', '不自动生成商机']) assert.ok(source.includes(fact), fact)
  const departmentSelect = readFileSync(new URL('../app/components/APFDepartmentSelect.vue', import.meta.url), 'utf8')
  assert.ok(departmentSelect.includes('DeptTreeSelector'))
  assert.ok(departmentSelect.includes('搜索部门名称或编码'))
  assert.ok(!source.includes('opportunity_id'))
  const fields = readFileSync(new URL('../shared/altoc-renewals.ts', import.meta.url), 'utf8')
  assert.equal((fields.match(/'renewals-[^']+'/g) || []).length, 4)
  const routes = readFileSync(new URL('../composition/business-api-routes.generated.mjs', import.meta.url), 'utf8')
  for (const path of ['/altoc/api/v1/renewals', '/altoc/api/v1/renewals/:renewalId']) assert.ok(routes.includes(path))
})
