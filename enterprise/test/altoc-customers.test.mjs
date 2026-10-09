import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { readFileSync } from 'node:fs'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'

test('Customer Host binds parent/child, fresh permit and stable key; failures precede Runtime', async () => {
  const calls = []
  globalThis.__customer = { calls, id: '1', child: 'CN-test', body: { name: '中文', expectedVersion: 2 }, allowed: true, failed: false }
  const hooks = registerHooks({ resolve(specifier, context, next) {
    let source
    if (specifier === 'h3') source = `export const createError=x=>Object.assign(new Error('fixed'),x);export const getRouterParam=(_e,k)=>k==='customerId'?globalThis.__customer.id:globalThis.__customer.child;export const getQuery=()=>({});export const getHeader=()=> 'stable-key';export const readBody=async()=>globalThis.__customer.body;export const setHeader=()=>{}`
    if (specifier.endsWith('/enterpriseRuntimeClient')) source = `export const requireEnterpriseUser=async()=>({uid:'Person',tenant:'C000001',deployment:'Host'});export const prepareEnterpriseRuntime=async()=>true;export const callEnterpriseRuntime=async(...args)=>{globalThis.__customer.calls.push(args);return {code:0,data:{data:{name:'中文'}}}}`
    if (specifier === './enterpriseAPF') source = `export const buildAPFPermit=async(_e,d,o,i,u)=>{if(globalThis.__customer.failed)throw Object.assign(Error('fixed'),{statusCode:503});if(!globalThis.__customer.allowed)throw Object.assign(Error('fixed'),{statusCode:403});return {actorUid:u.uid,tenant:u.tenant,deployment:u.deployment,objectId:i.id,resource:'customer',action:'edit',allowed:true,scope:{access:'self',departmentCodes:[]}}}`
    if (source) return { url: 'data:text/javascript,' + encodeURIComponent(source), shortCircuit: true }
    return next(specifier, context)
  } })
  try {
    const { enterpriseAltocCustomerWrite, customerOperations } = await import('../server/utils/enterpriseAltocCustomers.ts')
    assert.equal(customerOperations.length, 12)
    await enterpriseAltocCustomerWrite({}, 'contacts-update')
    await enterpriseAltocCustomerWrite({}, 'contacts-update')
    assert.equal(calls[0][1], 'altoc.wp4a-contacts-update')
    assert.equal(calls[0][2].authorization.objectId, '1|CN-test')
    assert.equal(calls[0][2].authorization.operation, 'contacts-update')
    assert.deepEqual(calls[0][2].customer, { customerId: '1', childCode: 'CN-test', payload: { name: '中文', expectedVersion: 2 } })
    assert.equal(calls[0][3].idempotencyKey, calls[1][3].idempotencyKey)
    globalThis.__customer.allowed = false
    await assert.rejects(enterpriseAltocCustomerWrite({}, 'contacts-update'), { statusCode: 403 })
    assert.equal(calls.length, 2)
    globalThis.__customer.allowed = true
    globalThis.__customer.failed = true
    await assert.rejects(enterpriseAltocCustomerWrite({}, 'contacts-update'), { statusCode: 503 })
    globalThis.__customer.id = '../1'
    await assert.rejects(enterpriseAltocCustomerWrite({}, 'contacts-update'), { statusCode: 400 })
  } finally {
    hooks.deregister()
    delete globalThis.__customer
  }
})

test('Customer page compiles and uses server total, versions, guarded actions and stable intents', () => {
  const source = readFileSync(new URL('../app/components/AltocCustomersPage.vue', import.meta.url), 'utf8')
  const { descriptor, errors } = parse(source)
  assert.deepEqual(errors, [])
  const script = compileScript(descriptor, { id: 'customer-page' })
  const template = compileTemplate({ source: descriptor.template.content, filename: 'AltocCustomersPage.vue', id: 'customer-page', compilerOptions: { bindingMetadata: script.bindings } })
  assert.deepEqual(template.errors, [])
  for (const fact of [':total="total"', '共 {{ total }} 条', 'expectedVersion', 'Idempotency-Key', 'createConsoleMutationIntent', 'useConfirm', 'tone: \'danger\'', 'invoice-profiles', 'canEdit', 'scopeKey', 'accessStatus']) assert.ok(source.includes(fact), fact)
  assert.equal(source.includes('Altoc 管理'), false)
  const manifest = JSON.parse(readFileSync(new URL('../../altoc/app.manifest.json', import.meta.url), 'utf8'))
  assert.ok(manifest.resources.find(r => r.code === 'customer').actions.includes('edit'))
})
