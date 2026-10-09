import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { readFileSync } from 'node:fs'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'

test('Quotation six operations bind intent, quotation permission and current actor; malformed and denied precede Runtime', async () => {
  const calls = []
  globalThis.__quote = { calls, id: '1', query: {}, body: { expectedVersion: 2, remark: '中文' }, allowed: true, dependency: false }
  const hooks = registerHooks({ resolve(specifier, context, next) {
    let source
    if (specifier === 'h3') source = `export const createError=x=>Object.assign(new Error('fixed'),x);export const getRouterParam=(_e,k)=>k==='quotationId'?globalThis.__quote.id:'1';export const getQuery=()=>globalThis.__quote.query;export const getHeader=()=> 'stable-key';export const readBody=async()=>globalThis.__quote.body;export const setHeader=()=>{}`
    if (specifier.endsWith('/enterpriseRuntimeClient')) source = `export const requireEnterpriseUser=async()=>({uid:'Person',tenant:'C000001',deployment:'Host'});export const prepareEnterpriseRuntime=async()=>true;export const callEnterpriseRuntime=async(...args)=>{globalThis.__quote.calls.push(args);return {code:0,data:args[1].includes('versions-list')?{data:[],total:0,page:2,pageSize:1}:{data:{id:1,items:[],cost_price:'secret'}}}}`
    if (specifier === './enterpriseAltocApproval') source = `export const submitAltocApproval=async()=>{throw Object.assign(Error('approval'),{statusCode:503})}`
    if (specifier === './enterpriseAPF') source = `export const buildAPFPermit=async(_e,d,o,i,u,resource)=>{if(globalThis.__quote.dependency)throw Object.assign(Error('fixed'),{statusCode:503});if(!globalThis.__quote.allowed)throw Object.assign(Error('fixed'),{statusCode:403});return {actorUid:u.uid,tenant:u.tenant,deployment:u.deployment,objectId:i.id,resource,action:o==='view'?'view':'edit',allowed:true,scope:{access:'self',departmentCodes:[]}}}`
    if (specifier === '../../shared/altoc-basic-read') return { url: new URL('../shared/altoc-basic-read.ts', import.meta.url).href, shortCircuit: true }
    if (source) return { url: 'data:text/javascript,' + encodeURIComponent(source), shortCircuit: true }
    return next(specifier, context)
  } })
  try {
    const { enterpriseAltocQuotation, quotationOperations, projectQuotationResult } = await import('../server/utils/enterpriseAltocQuotations.ts')
    assert.equal(quotationOperations.length, 6)
    const projected = projectQuotationResult({ data: { id: 1, version_no: 1, cost_price: 'secret', items: [{ id: 1, quotation_id: 1, cost_price: 'secret' }] } }, 'quotation-versions-view', '1', 1)
    assert.equal('cost_price' in projected.data, false)
    assert.equal('cost_price' in projected.data.items[0], false)
    assert.throws(() => projectQuotationResult({ data: { id: 2, items: [] } }, 'quotations-update', '1', 0), { statusCode: 503 })
    assert.throws(() => projectQuotationResult({ data: { id: 1, version_no: 2, items: [] } }, 'quotation-versions-view', '1', 1), { statusCode: 503 })
    await enterpriseAltocQuotation({}, 'quotations-update')
    await enterpriseAltocQuotation({}, 'quotations-update')
    assert.equal(calls[0][1], 'altoc.wp4b-quotations-update')
    assert.equal(calls[0][2].authorization.objectId, '1||0')
    assert.equal(calls[0][2].authorization.resource, 'quotation')
    assert.equal(calls[0][2].authorization.action, 'edit')
    assert.equal(calls[0][2].authorization.actorUid, 'Person')
    assert.equal(calls[0][3].idempotencyKey, calls[1][3].idempotencyKey)
    for (const field of ['status', 'owner_uid', 'approved_by', 'amount_tax_inclusive']) {
      globalThis.__quote.body = { expectedVersion: 2, [field]: 'fake' }
      await assert.rejects(enterpriseAltocQuotation({}, 'quotations-update'), { statusCode: 400 })
    }
    globalThis.__quote.query = { page: '2', pageSize: '1' }
    await enterpriseAltocQuotation({}, 'quotation-versions-list')
    assert.equal(calls.at(-1)[2].quotation.page, 2)
    assert.equal(calls.at(-1)[2].authorization.action, 'view')
    globalThis.__quote.query = {}
    globalThis.__quote.allowed = false
    await assert.rejects(enterpriseAltocQuotation({}, 'quotation-versions-list'), { statusCode: 403 })
    globalThis.__quote.allowed = true
    globalThis.__quote.dependency = true
    await assert.rejects(enterpriseAltocQuotation({}, 'quotation-versions-list'), { statusCode: 503 })
    globalThis.__quote.id = '../1'
    await assert.rejects(enterpriseAltocQuotation({}, 'quotation-versions-list'), { statusCode: 400 })
    assert.equal(calls.length, 3)
  } finally {
    hooks.deregister()
    delete globalThis.__quote
  }
})
test('Quotation page compiles; real totals, fixed decimal strings, stable intent, no browser approval', () => {
  const source = readFileSync(new URL('../app/components/AltocQuotationsPage.vue', import.meta.url), 'utf8')
  const { descriptor, errors } = parse(source)
  assert.deepEqual(errors, [])
  const script = compileScript(descriptor, { id: 'quote-page' })
  const compiled = compileTemplate({ source: descriptor.template.content, filename: 'AltocQuotationsPage.vue', id: 'quote-page', compilerOptions: { bindingMetadata: script.bindings } })
  assert.deepEqual(compiled.errors, [])
  for (const fact of [':total="total"', '共 {{ total }} 条', 'expectedVersion', 'Idempotency-Key', 'createConsoleMutationIntent', 'useConfirm', 'versionTotal', 'versionPage', 'scopeKey', 'accessStatus', '审批处理中', '\'draft\', \'rejected\'', 'unit_price', 'discount_rate', 'tax_rate']) assert.ok(source.includes(fact), fact)
  assert.ok(descriptor.template.content.includes('@click="transition(\'submit\')"'))
  assert.equal(source.includes('transition(\'approve\')'), false)
  const manifest = JSON.parse(readFileSync(new URL('../../altoc/app.manifest.json', import.meta.url), 'utf8'))
  assert.ok(manifest.resources.find(r => r.code === 'quotation').actions.includes('edit'))
})
