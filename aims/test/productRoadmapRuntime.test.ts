import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { createError } from 'h3'
import * as input from '../server/utils/productRoadmapInput'
import * as crossInput from '../server/utils/productCrossDependencyInput'
import * as workspace from '../server/utils/productWorkspaceInput'
const id = '00000000-0000-4000-8000-000000000001'
const draft = { startsOn: '2026-10-01', endsOn: '2027-03-31', expectedRevision: 5, expectedItemRevision: 2, reason: '季度安排' }
const compiled = ts.transpileModule(readFileSync(new URL('../server/utils/productRoadmapRuntime.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
function harness(options: { method?: string, path?: string, body?: unknown, query?: Record<string, unknown>, key?: string | null, denied?: boolean, deniedResource?: string, mixedFacts?: boolean, unavailable?: boolean, targetUnavailable?: boolean, staleDiscovery?: boolean } = {}) {
 const calls: any[] = [], permissions: string[] = []
 const exports: any = {}
 runInNewContext(compiled, { exports, require: (name: string) => {
  if (name === 'h3') return { createError, getRouterParam: (_: unknown, key: string) => key === 'productCode' ? '产品 A' : options.path ?? `windows/${id}`, getQuery: () => options.query || {}, readBody: async () => options.body ?? draft, getHeader: () => options.key === undefined ? 'roadmap-key' : options.key, setHeader: () => {} }
  if (name === './productRoadmapPermissions') return { productRoadmapPermissions: async () => ({ code: 0, data: { edit: true } }) }
  if (name === './productCrossDependencyInput') return crossInput
  if (name === './productRoadmapInput') return input
  if (name === './productWorkspaceInput') return workspace
  if (name === './productAuthorization') return { checkProductPermission: async (_: unknown, code: string) => { if(options.targetUnavailable) throw createError({statusCode:503}); return {allowed:code!=='HIDDEN',facts:{product_code:code,actor_uid:'session-user',revision:1}} }, requireProductPermission: async (_: unknown, code: string, resource: string, action: string) => { permissions.push(`${code}:${resource}:${action}`); if (options.denied || options.deniedResource === resource) throw createError({ statusCode: 403 }); return { product_code: code, actor_uid: 'session-user', status: 'active', is_member: true, is_manager: true, revision: options.mixedFacts && resource === 'product_priorities' ? 6 : 5 } } }
  if (name.endsWith('/tenantRuntimeClient')) return { maybeCallTenantRuntime: async (_: unknown, path: string, args: unknown) => { calls.push({ path, args }); return { handled: !options.unavailable, data: { code: 0, data: path.endsWith(':cross-snapshot-targets') ? {product_code:'产品 A',commitment_biz_id:id,workspace_revision:options.staleDiscovery?6:5,product_codes:['VISIBLE','HIDDEN']} : {} } } } }
  if (name === './aimsRuntimeForward') return { runtimeEnvelopeError: () => createError({ statusCode: 409 }) }
  throw new Error(name)
 } })
 return { run: () => exports.handleProductRoadmap({ method: options.method ?? 'PATCH' }), calls, permissions }
}
test('roadmap window binds route identity, trusted actor and precise service capability', async () => {
 const h = harness(); await h.run()
 assert.deepEqual(h.permissions, ['产品 A:product_roadmaps:edit'])
 assert.ok(h.calls[0].path.endsWith('/roadmaps:window-edit'))
 assert.equal(h.calls[0].args.scope, 'aims.write aims:product-roadmaps:window-edit')
 assert.equal(h.calls[0].args.query.current_user, 'session-user')
 assert.equal(h.calls[0].args.idempotencyKey, 'roadmap-key')
 assert.equal(h.calls[0].args.body.input.biz_id, id)
 assert.equal(h.calls[0].args.body.input.expected_item_revision, 2)
 const read = harness({ method: 'GET' }); await read.run()
 assert.equal(read.calls[0].args.scope, 'aims.read aims:product-roadmaps:read')
 assert.equal(read.calls[0].args.idempotencyKey, undefined)
})
test('roadmap window rejects malformed input and unsupported routes before runtime', async () => {
 for (const change of [{ startsOn: '2026-02-30' }, { startsOn: null }, { endsOn: '2026-01-01' }, { startsOn: undefined }, { expectedItemRevision: '2' }, { reason: '' }, { biz_id: id }, { actor: 'other' }, { committed: true }]) {
  const h = harness({ body: { ...draft, ...change } }); await assert.rejects(h.run(), { statusCode: 400 }); assert.equal(h.calls.length, 0)
 }
 const clear = harness({ body: { ...draft, startsOn: null, endsOn: null } }); await clear.run(); assert.equal(clear.calls[0].args.body.input.starts_on, null)
 await assert.rejects(harness({ key: null }).run(), { statusCode: 400 })
 await assert.rejects(harness({ query: { actor: 'other' } }).run(), { statusCode: 400 })
 await assert.rejects(harness({ path: `windows/${id}/extra` }).run(), { statusCode: 404 })
 await assert.rejects(harness({ method: 'DELETE' }).run(), { statusCode: 405 })
 await assert.rejects(harness({ denied: true }).run(), { statusCode: 403 })
 await assert.rejects(harness({ unavailable: true }).run(), { statusCode: 503 })
})

test('roadmap permission route is read-only and rejects query authority', async () => {
 const h = harness({ path: 'permissions', method: 'GET' }); await h.run(); assert.equal(h.calls.length, 0)
 await assert.rejects(harness({ path: 'permissions' }).run(), { statusCode: 405 })
 await assert.rejects(harness({ path: 'permissions', method: 'GET', query: { actor: 'other' } }).run(), { statusCode: 400 })
})

test('quarter roadmap forwards validated filters with both read permissions', async () => {
 const query = {cycleId:id,year:'2027',quarter:'1',unscheduled:'false',page:'2',pageSize:'10'}
 const h=harness({path:'quarter',method:'GET',query});await h.run()
 assert.deepEqual(h.permissions,['产品 A:product_roadmaps:view','产品 A:product_priorities:view'])
 const call=h.calls[0]
 assert.ok(call.path.endsWith('/roadmaps:quarter-view'))
 assert.equal(call.args.scope,'aims.read aims:product-roadmaps:read')
 assert.equal(call.args.body.input.cycle_biz_id,id)
 assert.equal(call.args.body.input.year,2027)
 assert.equal(call.args.body.input.page,2)
 assert.equal(call.args.body.planning_authorization.resource,'product_priorities')
 assert.equal(call.args.idempotencyKey,undefined)
 for(const change of [{quarter:'5'},{year:'0999'},{page:'0'},{pageSize:'101'},{year:['2027']},{cycleId:'invalid'},{unscheduled:'1'},{actor:'other'},{quarter:'1.0'}]) {
  const bad=harness({path:'quarter',method:'GET',query:{...query,...change}})
  await assert.rejects(bad.run(),{statusCode:400});assert.equal(bad.calls.length,0)
 }
 await assert.rejects(harness({path:'quarter',method:'PATCH',query}).run(),{statusCode:405})
 await assert.rejects(harness({path:'quarter',method:'GET',query,denied:true}).run(),{statusCode:403})
 await assert.rejects(harness({path:'quarter',method:'GET',query,unavailable:true}).run(),{statusCode:503})
})

test('quarter roadmap rejects missing second permission and inconsistent facts before transport', async () => {
 const base={path:'quarter',method:'GET',query:{cycleId:id,year:'2027',quarter:'1'}}
 for(const options of [{deniedResource:'product_priorities'},{mixedFacts:true}]) {
  const h=harness({...base,...options})
  await assert.rejects(h.run(),{statusCode:'mixedFacts' in options ? 409 : 403})
  assert.equal(h.calls.length,0)
 }
})

test('roadmap commit requires separate permission and rejects client snapshots', async () => {
 const body={cycleId:id,expectedRevision:5,expectedItemRevision:2,expectedCycleRevision:3,expectedQueueRevision:4,expectedPreviousId:0,reason:'确认基线'}
 const h=harness({path:`commit/${id}`,method:'POST',body});await h.run()
 assert.deepEqual(h.permissions,['产品 A:product_roadmaps:commit'])
 assert.equal(h.calls[0].args.scope,'aims.write aims:product-roadmaps:commit')
 assert.equal(h.calls[0].args.body.input.item_biz_id,id)
 assert.equal(h.calls[0].args.body.input.expected_previous_id,0)
 assert.equal(h.calls[0].args.idempotencyKey,'roadmap-key')
 for(const change of [{expectedPreviousId:undefined},{expectedPreviousId:-1},{expectedCycleRevision:'3'},{cycleId:'invalid'},{snapshot:{}},{actor:'other'},{reason:''}]) {
  const bad=harness({path:`commit/${id}`,method:'POST',body:{...body,...change}})
  await assert.rejects(bad.run(),{statusCode:400});assert.equal(bad.calls.length,0)
 }
 await assert.rejects(harness({path:`commit/${id}`,method:'GET',body}).run(),{statusCode:405})
 await assert.rejects(harness({path:`commit/${id}`,method:'POST',body,key:null}).run(),{statusCode:400})
})

test('commitment history binds item route and paginates under both permissions', async () => {
 const base={path:`commitments/${id}`,method:'GET'}
 const h=harness({...base,query:{page:'2',pageSize:'10'}});await h.run()
 assert.ok(h.calls[0].path.endsWith('/roadmaps:commitments'))
 assert.equal(h.calls[0].args.body.input.biz_id,id)
 assert.equal(h.calls[0].args.body.input.page,2)
 assert.equal(h.calls[0].args.body.input.page_size,10)
 assert.deepEqual(h.permissions,['产品 A:product_roadmaps:view','产品 A:product_priorities:view'])
 assert.equal(h.calls[0].args.idempotencyKey,undefined)
 for(const query of [{page:'0'},{page:['1']},{pageSize:'101'},{actor:'other'},{biz_id:id}]) {
  const bad=harness({...base,query});await assert.rejects(bad.run(),{statusCode:400});assert.equal(bad.calls.length,0)
 }
 await assert.rejects(harness({...base,method:'POST'}).run(),{statusCode:405})
 await assert.rejects(harness({...base,deniedResource:'product_priorities'}).run(),{statusCode:403})
 await assert.rejects(harness({...base,mixedFacts:true}).run(),{statusCode:409})
})

test('historical predecessor BFF discovers privately and authorizes visible targets',async()=>{
 const h=harness({path:`cross-snapshots/${id}`,method:'GET',query:{page:'2'}})
 const result=await h.run()
 assert.equal(h.calls.length,2)
 assert.ok(h.calls[0].path.endsWith(':cross-snapshot-targets'))
 assert.ok(h.calls[1].path.endsWith(':cross-snapshots'))
 assert.deepEqual(Object.keys(h.calls[1].args.body.predecessor_authorizations),['VISIBLE'])
 assert.equal(h.calls[1].args.body.input.biz_id,id)
 assert.equal(h.calls[1].args.body.input.page,2)
 assert.equal(result.data.product_codes,undefined)
 for(const [options,statusCode] of [[{staleDiscovery:true},409],[{targetUnavailable:true},503],[{query:{actor:'forged'}},400]] as const){
  await assert.rejects(harness({path:`cross-snapshots/${id}`,method:'GET',...options}).run(),{statusCode})
 }
})
