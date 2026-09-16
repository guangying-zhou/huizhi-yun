import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { createError } from 'h3'
import * as input from '../server/utils/productObjectiveInput'
import * as versionInput from '../server/utils/productVersionInput'
import * as workspace from '../server/utils/productWorkspaceInput'

interface RuntimeArgs { scope: string, idempotencyKey?: string, query: { current_user: string }, body: { input: Record<string, unknown>, authorization: { facts: { actor_uid: string } } } }

const compiled = ts.transpileModule(readFileSync(new URL('../server/utils/productObjectiveRuntime.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
function harness(options: { body?: unknown, query?: Record<string, unknown>, key?: string | null, denied?: boolean, response?: unknown } = {}) {
  const calls: { path: string, args: RuntimeArgs }[] = []
  const permissions: string[] = []
  const headers: Record<string, string> = {}
  const exports: Record<string, (event: unknown, action: string) => Promise<unknown>> = {}
  runInNewContext(compiled, { exports, require: (name: string) => {
    if (name === 'h3') return { createError, getRouterParam: (_event: unknown, key: string) => (({ productCode: '产品 A', objectiveId: '12' } as Record<string, string | undefined>)[key]), getQuery: () => options.query || {}, readBody: async () => options.body || draft, getHeader: () => options.key === undefined ? 'objective-key' : options.key, setHeader: (_event: unknown, key: string, value: string) => {
      headers[key] = value
    } }
    if (name === './productObjectiveInput') return input
    if (name === './productVersionInput') return versionInput
    if (name === './productWorkspaceInput') return workspace
    if (name === './productObjectivePermissions') return { productObjectivePermissions: async () => ({ code: 0, data: { edit: true } }) }
    if (name === './productAuthorization') return { requireProductPermission: async (_event: unknown, code: string, resource: string, action: string) => {
      permissions.push(`${code}:${resource}:${action}`)
      if (options.denied) throw createError({ statusCode: 403 })
      return { actor_uid: 'session-user', revision: 7 }
    } }
    if (name.endsWith('/tenantRuntimeClient')) return { maybeCallTenantRuntime: async (_event: unknown, path: string, args: RuntimeArgs) => {
      calls.push({ path, args })
      return options.response ?? { handled: true, data: { code: 0, data: { ok: true } } }
    } }
    if (name === './aimsRuntimeForward') return { runtimeEnvelopeError: () => createError({ statusCode: 409 }) }
    throw new Error(`Unexpected dependency ${name}`)
  } })
  return { run: (action: string) => exports.handleProductObjective!({}, action), calls, permissions, headers }
}


const draft = { title: '降低失败率', startsOn: '2026-09-01', endsOn: '2026-12-31', ownerUid: 'pm', expectedRevision: 1, metric: { name: '失败率', unit: '%', measurementDefinition: '失败次数/总次数', direction: 'decrease', baselineValue: '5', targetValue: '2' } }

test('objective create binds trusted actor, precise capability and idempotency', async () => {
 const h=harness(); await h.run('create')
 assert.deepEqual(h.permissions,['产品 A:product_objectives:edit'])
 const call=h.calls[0]!
 assert.equal(call.path, `/v1/aims/internal/products/${encodeURIComponent('产品 A')}/objectives:create`)
 assert.equal(call.args.scope,'aims.write aims:product-objectives:create')
 assert.equal(call.args.idempotencyKey,'objective-key')
 assert.equal(call.args.query.current_user,'session-user')
 assert.equal(call.args.body.input.owner_uid,'pm')
 assert.equal(h.headers['Cache-Control'],'no-store')
})

test('objective reads use read capability, validated pagination and route identity',async()=>{
 const h=harness({query:{status:'draft',page:'2',pageSize:'10'}});await h.run('list')
 assert.equal(h.calls[0]!.args.scope,'aims.read aims:product-objectives:read')
 assert.equal(h.calls[0]!.args.body.input.page,2)
 assert.equal(h.calls[0]!.args.idempotencyKey,undefined)
 const detail=harness();await detail.run('view');assert.equal(detail.calls[0]!.args.body.input.id,12)
 await assert.rejects(harness({query:{id:'99'}}).run('view'),{statusCode:400})
})

test('objective invalid inputs and denial never reach runtime; unavailable remains 503',async()=>{
 for(const options of [{key:null},{query:{actor:'other'}},{body:{...draft,actor:'other'}},{body:{...draft,startsOn:'2026-02-30'}},{body:{...draft,metric:{...draft.metric,targetValue:'6'}}}]){
 const h=harness(options);await assert.rejects(h.run('create'),{statusCode:400});assert.equal(h.calls.length,0)
 }
 const h=harness({denied:true});await assert.rejects(h.run('create'),{statusCode:403});assert.equal(h.calls.length,0)
 await assert.rejects(harness({response:{handled:false}}).run('create'),{statusCode:503})
 await assert.rejects(harness({response:{handled:true,data:{code:409}}}).run('create'),{statusCode:409})
})

test('objective values retain precision and reject malformed or equal targets',()=>{
 const metric={...draft.metric,direction:'increase',baselineValue:'99999999999999.999997',targetValue:'99999999999999.999999'}
 assert.equal(input.productObjectiveCreateInput({...draft,metric})?.metric.target_value,metric.targetValue)
 for(const value of ['NaN','1e2','1.0000001','100000000000000','99999999999999.999997'])assert.equal(input.productObjectiveCreateInput({...draft,metric:{...metric,targetValue:value}}),null)
 assert.equal(input.productObjectiveCreateInput({...draft,endsOn:'2026-08-31'}),null)
 assert.equal(input.productObjectivePageInput({page:'0'}),null)
 assert.equal(input.productObjectivePageInput({status:'unknown'}),null)
})

test('objective transitions bind independent permissions and route identity', async () => {
  for (const action of ['activate', 'close', 'reopen', 'archive']) {
    const body = { expectedRevision: 4, expectedObjectiveRevision: 2, reason: '调整目标状态' }
    const h = harness({ body }); await h.run(action)
    assert.deepEqual(h.permissions, [`产品 A:product_objectives:${action}`])
    assert.equal(h.calls[0]!.args.scope, `aims.write aims:product-objectives:${action}`)
    assert.equal(h.calls[0]!.args.body.input.action, action)
    assert.equal(h.calls[0]!.args.body.input.objective_id, 12)
    assert.equal(h.calls[0]!.args.body.input.expected_objective_revision, 2)
    assert.equal(h.calls[0]!.args.idempotencyKey, 'objective-key')
    const bad = harness({ body: { ...body, action: 'reopen' } })
    await assert.rejects(bad.run(action), { statusCode: 400 }); assert.equal(bad.calls.length, 0)
    await assert.rejects(harness({ body, denied: true }).run(action), { statusCode: 403 })
  }
})

test('objective observations preserve decimals and reject client authority or snapshots', async () => {
  const body = { expectedRevision: 3, expectedObjectiveRevision: 2, observedOn: '2026-09-01', measuredValue: '99999999999999.999999', evidence: '统计报表' }
  const h = harness({ body }); await h.run('observe')
  assert.deepEqual(h.permissions, ['产品 A:product_objectives:observe'])
  assert.equal(h.calls[0]!.args.scope, 'aims.write aims:product-objectives:observe')
  assert.equal(h.calls[0]!.args.body.input.measured_value, body.measuredValue)
  for (const change of [{ objectiveId: 99 }, { metricSnapshot: {} }, { attainment: '100' }, { evidence: '' }, { observedOn: '2026-02-30' }, { measuredValue: '1e2' }, { expectedObjectiveRevision: 0 }]) {
    const bad = harness({ body: { ...body, ...change } }); await assert.rejects(bad.run('observe'), { statusCode: 400 }); assert.equal(bad.calls.length, 0)
  }
  await assert.rejects(harness({ body, key: null }).run('observe'), { statusCode: 400 })
  await assert.rejects(harness({ body, denied: true }).run('observe'), { statusCode: 403 })
})

test('objective observation history uses route identity and read scope with pagination', async () => {
  const h = harness({ query: { page: '2', pageSize: '10' }, key: null })
  await h.run('observations')
  assert.deepEqual(h.permissions, ['产品 A:product_objectives:view'])
  const call = h.calls[0]!
  assert.equal(call.path, `/v1/aims/internal/products/${encodeURIComponent('产品 A')}/objectives:observations`)
  assert.equal(call.args.scope, 'aims.read aims:product-objectives:read')
  assert.equal(call.args.idempotencyKey, undefined)
  assert.equal(call.args.body.input.objective_id, 12)
  assert.equal(call.args.body.input.page, 2)
  assert.equal(call.args.body.input.page_size, 10)
  for (const query of [{ objectiveId: '99' }, { status: 'active' }, { page: '0' }, { pageSize: '101' }, { page: ['1', '2'] }]) {
    const bad = harness({ query })
    await assert.rejects(bad.run('observations'), { statusCode: 400 })
    assert.equal(bad.calls.length, 0)
  }
  await assert.rejects(harness({ denied: true }).run('observations'), { statusCode: 403 })
  await assert.rejects(harness({ response: { handled: false } }).run('observations'), { statusCode: 503 })
})

test('objective route dispatcher preserves exact URLs and HTTP methods', () => {
  assert.deepEqual(input.productObjectiveRoute('12', 'GET'), { id: '12', action: 'view', methodAllowed: true })
  assert.deepEqual(input.productObjectiveRoute('12/observations', 'GET'), { id: '12', action: 'observations', methodAllowed: true })
  for (const action of ['activate', 'close', 'reopen', 'archive', 'observe']) {
    assert.deepEqual(input.productObjectiveRoute(`12/${action}`, 'POST'), { id: '12', action, methodAllowed: true })
    assert.equal(input.productObjectiveRoute(`12/${action}`, 'GET')?.methodAllowed, false)
  }
  assert.equal(input.productObjectiveRoute('12', 'POST')?.methodAllowed, false)
  assert.equal(input.productObjectiveRoute('12/observations', 'POST')?.methodAllowed, false)
  for (const path of [undefined, '', '0', '01', '-1', '1.5', '9007199254740992', '12/', '12/delete', '12/observe/extra', '../observe']) assert.equal(input.productObjectiveRoute(path, 'POST'), null)
})

test('catch-all handler forwards parsed objective ID and rejects method or path before runtime', async () => {
  const routeSource = ts.transpileModule(readFileSync(new URL('../server/api/v1/products/[productCode]/objectives/[...objectivePath].ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  for (const sample of [{ path: '27/close', method: 'POST', status: 0 }, { path: '27/close', method: 'GET', status: 405 }, { path: '27/close/extra', method: 'POST', status: 404 }]) {
    const calls: unknown[][] = []
    const exports: { default?: (event: { method: string }) => Promise<unknown> } = {}
    runInNewContext(routeSource, { exports, defineEventHandler: (handler: unknown) => handler, require: (name: string) => {
      if (name === 'h3') return { createError, getRouterParam: () => sample.path }
      if (name.endsWith('/productObjectiveInput')) return input
      if (name.endsWith('/productItemObjectivesRuntime')) return { handleProductItemObjectives: () => { throw new Error('Unexpected item-objective dispatch') } }
      if (name.endsWith('/productObjectiveRuntime')) return { handleProductObjective: async (...args: unknown[]) => { calls.push(args); return { code: 0 } } }
      throw new Error(name)
    } })
    const run = async () => exports.default!({ method: sample.method })
    if (sample.status) { await assert.rejects(run(), { statusCode: sample.status }); assert.equal(calls.length, 0) }
    else { await run(); assert.equal(calls[0]![1], 'close'); assert.equal(calls[0]![2], '27') }
  }
})

test('objective permissions share catch-all dispatch and reject query authority', async () => {
  assert.deepEqual(input.productObjectiveRoute('permissions', 'GET'), { id: undefined, action: 'permissions', methodAllowed: true })
  assert.equal(input.productObjectiveRoute('permissions', 'POST')?.methodAllowed, false)
  const h = harness(); await h.run('permissions'); assert.equal(h.calls.length, 0)
  await assert.rejects(harness({ query: { actor: 'other' } }).run('permissions'), { statusCode: 400 })
})

test('objective correction BFF pairs original ID and reason without client snapshot authority', async () => {
  const body = { expectedRevision: 9, expectedObjectiveRevision: 3, observedOn: '2026-09-01', measuredValue: '4', evidence: '更正后的日报', correctionOfId: 41, correctionReason: '修正统计分母' }
  const h = harness({ body }); await h.run('observe')
  const call = h.calls[0]!
  assert.equal(call.args.body.input.objective_id, 12)
  assert.equal(call.args.body.input.correction_of_id, 41)
  assert.equal(call.args.body.input.correction_reason, body.correctionReason)
  assert.equal(call.args.body.input.expected_objective_revision, 3)
  assert.equal(call.args.scope, 'aims.write aims:product-objectives:observe')
  assert.deepEqual(h.permissions, ['产品 A:product_objectives:observe'])
  assert.equal(call.args.idempotencyKey, 'objective-key')
  for (const change of [{ correctionOfId: null }, { correctionOfId: 0 }, { correctionOfId: '41' }, { correctionReason: '' }, { correctionReason: undefined }, { metricSnapshot: {} }, { objectiveRevision: 1 }]) {
    const bad = harness({ body: { ...body, ...change } }); await assert.rejects(bad.run('observe'), { statusCode: 400 }); assert.equal(bad.calls.length, 0)
  }
  const { correctionOfId: _id, ...orphan } = body
  await assert.rejects(harness({ body: orphan }).run('observe'), { statusCode: 400 })
})


test('objective edit binds route identity, both revisions and independent capability', async () => {
  const body = { ...draft, expectedRevision: 7, expectedObjectiveRevision: 3, reason: '调整统计目标' }
  const h = harness({ body }); await h.run('edit')
  assert.deepEqual(h.permissions, ['产品 A:product_objectives:edit'])
  const call = h.calls[0]!
  assert.ok(call.path.endsWith('/objectives:edit'))
  assert.equal(call.args.scope, 'aims.write aims:product-objectives:edit')
  assert.equal(call.args.idempotencyKey, 'objective-key')
  assert.equal(call.args.body.input.objective_id, 12)
  assert.equal(call.args.body.input.expected_revision, 7)
  assert.equal(call.args.body.input.expected_objective_revision, 3)
  assert.equal(call.args.body.input.reason, body.reason)
  assert.deepEqual(input.productObjectiveRoute('12/edit', 'POST'), { id: '12', action: 'edit', methodAllowed: true })
  assert.equal(input.productObjectiveRoute('12/edit', 'GET')?.methodAllowed, false)
  for (const change of [{ objective_id: 99 }, { objectiveId: 99 }, { actor: 'other' }, { status: 'active' }, { reason: '' }, { reason: ' ' }, { expectedObjectiveRevision: 0 }, { expectedObjectiveRevision: '3' }, { startsOn: '2026-02-30' }, { metric: { ...draft.metric, targetValue: '6' } }]) {
    const bad = harness({ body: { ...body, ...change } })
    await assert.rejects(bad.run('edit'), { statusCode: 400 })
    assert.equal(bad.calls.length, 0)
  }
  const denied = harness({ body, denied: true })
  await assert.rejects(denied.run('edit'), { statusCode: 403 })
  assert.equal(denied.calls.length, 0)
})


test('objective item links validate three revisions and use edit business permission', async () => {
  const body = { expectedRevision: 7, expectedObjectiveRevision: 3, planningItemId: 21, expectedPlanningRevision: 2, contributionNote: '改善稳定性', remove: false, reason: '建立追踪' }
  const h = harness({ body }); await h.run('item-link')
  assert.deepEqual(h.permissions, ['产品 A:product_objectives:edit'])
  assert.equal(h.calls[0]!.args.scope, 'aims.write aims:product-objectives:item-link')
  assert.equal(h.calls[0]!.args.body.input.objective_id, 12)
  assert.equal(h.calls[0]!.args.body.input.planning_item_id, 21)
  assert.equal(h.calls[0]!.args.body.input.expected_planning_revision, 2)
  for (const change of [{ objectiveId: 8 }, { planningItemId: '21' }, { expectedPlanningRevision: 0 }, { remove: 'false' }, { contributionNote: '' }, { reason: '' }, { remove: true }]) {
    const bad = harness({ body: { ...body, ...change } })
    await assert.rejects(bad.run('item-link'), { statusCode: 400 })
    assert.equal(bad.calls.length, 0)
  }
  const remove = harness({ body: { ...body, remove: true, contributionNote: '' } }); await remove.run('item-link')
  assert.equal(remove.calls[0]!.args.body.input.remove, true)
  const read = harness({ query: { page: '2', pageSize: '10' } }); await read.run('items')
  assert.equal(read.calls[0]!.args.scope, 'aims.read aims:product-objectives:read')
  assert.equal(read.calls[0]!.args.body.input.objective_id, 12)
  assert.equal(read.calls[0]!.args.idempotencyKey, undefined)
  assert.equal(input.productObjectiveRoute('12/items', 'GET')?.methodAllowed, true)
  assert.equal(input.productObjectiveRoute('12/item-link', 'POST')?.methodAllowed, true)
})


test('cycle mapping BFF rejects client snapshots and binds route identity with exact capabilities', async () => {
  for (const action of ['cycle-map', 'cycle-revoke']) {
    const body = { expectedRevision: 5, expectedObjectiveRevision: 2, reason: '调整周期映射', ...(action === 'cycle-map' ? { cycleId: 9, expectedCycleRevision: 3 } : { mappingId: 7 }) }
    const h = harness({ body }); await h.run(action)
    assert.deepEqual(h.permissions, ['产品 A:product_objectives:edit'])
    assert.equal(h.calls[0]!.args.scope, `aims.write aims:product-objectives:${action}`)
    assert.equal(h.calls[0]!.args.body.input.objective_id, 12)
    assert.equal(h.calls[0]!.args.idempotencyKey, 'objective-key')
    assert.equal(h.calls[0]!.args.body.input[action === 'cycle-map' ? 'cycle_id' : 'mapping_id'], action === 'cycle-map' ? 9 : 7)
    const invalidID = action === 'cycle-map' ? { cycleId: '9' } : { mappingId: 0 }
    for (const change of [{ reason: '' }, { objectiveId: 8 }, { objective_snapshot: {} }, { cycle_snapshot: {} }, { expectedObjectiveRevision: 0 }, invalidID]) {
      const bad = harness({ body: { ...body, ...change } })
      await assert.rejects(bad.run(action), { statusCode: 400 })
      assert.equal(bad.calls.length, 0)
    }
    const denied = harness({ body, denied: true }); await assert.rejects(denied.run(action), { statusCode: 403 })
    assert.equal(denied.calls.length, 0)
    assert.equal(input.productObjectiveRoute(`12/${action}`, 'POST')?.methodAllowed, true)
    assert.equal(input.productObjectiveRoute(`12/${action}`, 'GET')?.methodAllowed, false)
  }
  const read = harness({ query: { page: '2', pageSize: '10' } }); await read.run('cycles')
  assert.equal(read.calls[0]!.args.scope, 'aims.read aims:product-objectives:read')
  assert.equal(read.calls[0]!.args.body.input.page, 2)
  assert.equal(read.calls[0]!.args.body.input.objective_id, 12)
  assert.equal(input.productObjectiveRoute('12/cycles', 'GET')?.methodAllowed, true)
})
