import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { readFileSync } from 'node:fs'

// One stub set for the whole file: the module under test is loaded once, so every
// test must resolve its dependencies to the same sources and steer them via state.
function queueHooks() {
  return registerHooks({ resolve(specifier, context, next) {
    let source
    if (specifier === 'h3') source = `const s=()=>globalThis.__queue;export const createError=x=>Object.assign(Error('fixed'),x);export const getQuery=()=>s().query;export const getHeader=()=>s().key;export const getRouterParam=(_e,n)=>s()[n];export const readBody=async()=>s().body;export const setHeader=()=>{}`
    if (specifier.endsWith('/enterpriseRuntimeClient')) source = `const s=()=>globalThis.__queue;export const requireEnterpriseUser=async()=>({uid:'admin',tenant:'C000001',deployment:'Host'});export const prepareEnterpriseRuntime=async()=>true;export const enterpriseRuntimePermitExpiresAt=()=>Date.now()+14000;export const callEnterpriseRuntime=async(...a)=>{s().calls.push(a);if(s().fail)throw Object.assign(Error('fixed'),{statusCode:s().fail});if(s().response)return s().response;if(a[2].migrationResolve||a[2].migrationIdentity)return {code:0,data:{data:{id:11,status:'resolved'}}};return {code:0,data:{data:[{id:1,kind:'owner_unmatched'}],total:1,page:a[2].page,pageSize:a[2].pageSize,openCounts:{owner_unmatched:1}}}}`
    if (specifier.endsWith('/platformBundleAuthorization')) source = `export const loadScopedAuthorizationFromConsoleRuntime=async(_e,uid,app,required)=>{globalThis.__queue.scoped.push([app,required]);return {uid,appCode:app,bundleVersion:'1',bundleHash:'hash',policyRevision:1,grants:[],actionPolicy:{},authorizationExpiresAt:Date.now()+60000}}`
    if (specifier.endsWith('/scopeEvaluator')) source = `export const evaluateFoundationScopedAuthorization=x=>{globalThis.__queue.evaluated.push(x.required);return {allowed:globalThis.__queue.allowed}}`
    if (specifier === './enterpriseAPF') source = `export const buildAPFPermit=async(_e,d,o,i,u,resource,action)=>{globalThis.__queue.permits.push([d,o,resource,action]);if(globalThis.__queue.customerDenied)throw Object.assign(Error('fixed'),{statusCode:403});return {scope:{access:'self_dept',departmentCodes:['D-1']}}}`
    if (source) return { url: 'data:text/javascript,' + encodeURIComponent(source), shortCircuit: true }
    return next(specifier, context)
  } })
}

test('migration queue reads: per-app resource, closed query, unrestricted scope permit', async () => {
  const state = { calls: [], scoped: [], evaluated: [], permits: [], query: {}, allowed: true, response: null }
  globalThis.__queue = state
  const hooks = queueHooks()
  try {
    const { enterpriseAltocMigrationExceptions, enterpriseAltocMigrationIdentities, enterpriseFinanceMigrationExceptions, normalizeMigrationQueueRequest, migrationQueueKinds } = await import('../server/utils/enterpriseMigrationQueue.ts')
    state.query = { kind: 'contact_without_customer', search: '张', page: '2' }
    const out = await enterpriseAltocMigrationExceptions({})
    assert.deepEqual(Object.keys(out).sort(), ['data', 'openCounts', 'page', 'pageSize', 'total'])
    assert.deepEqual(state.scoped[0], ['altoc', { resourceCode: 'migration_exceptions', action: 'view' }])
    assert.deepEqual(state.evaluated[0], { appCode: 'altoc', resourceCode: 'migration_exceptions', action: 'view' })
    const [, op, body, options] = state.calls[0]
    assert.equal(op, 'altoc.w3-migration-exceptions-page')
    assert.deepEqual({ id: body.id, code: body.code, name: body.name, rowVersion: body.rowVersion, page: body.page, pageSize: body.pageSize, search: body.search }, { id: '', code: 'contact_without_customer', name: '', rowVersion: 0, page: 2, pageSize: 20, search: '张' })
    assert.deepEqual([body.authorization.resource, body.authorization.action, body.authorization.operation, body.authorization.objectId, body.authorization.scope.access], ['migration_exceptions', 'view', 'migration-exceptions-page', '', 'all'])
    assert.equal(options, undefined)
    // Reads never ask for a customer permit.
    assert.equal(state.permits.length, 0)

    state.query = {}
    await enterpriseFinanceMigrationExceptions({})
    assert.deepEqual([state.calls[1][1], state.scoped[1][0], state.evaluated[1].appCode], ['finance.w3-migration-exceptions-page', 'finance', 'finance'])
    state.query = { status: 'candidate', search: '王' }
    const people = await enterpriseAltocMigrationIdentities({})
    assert.deepEqual([state.calls[2][1], state.calls[2][2].authorization.operation, Object.hasOwn(people, 'openCounts')], ['altoc.w3-migration-identities-page', 'migration-identities-page', false])

    state.query = { kind: 'balance_without_account', exceptionId: '9', page: '2', pageSize: '20' }
    await enterpriseFinanceMigrationExceptions({})
    const detail = state.calls.at(-1)[2]
    assert.equal(detail.id, '9')
    assert.equal(detail.authorization.objectId, '9')
    assert.equal(detail.authorization.resource, 'migration_exceptions')
    assert.equal(detail.authorization.action, 'view')
    assert.equal(detail.page, 2)
    for (const [app, query] of [['altoc', { kind: 'balance_without_account', exceptionId: '9' }], ['finance', { kind: 'contract_balance_mismatch', exceptionId: '9' }], ['finance', { kind: 'balance_without_account', exceptionId: '9', status: 'open' }], ['finance', { kind: 'balance_without_account', exceptionId: '09' }]]) assert.throws(() => normalizeMigrationQueueRequest(app, 'exceptions', query), { statusCode: 400 })
    // Closed query: kinds stay inside their app, search only where it means something.
    for (const [app, view, query] of [
      ['altoc', 'exceptions', { kind: 'balance_without_account' }], ['finance', 'exceptions', { kind: 'owner_unmatched' }], ['altoc', 'exceptions', { kind: 'anything' }],
      ['altoc', 'exceptions', { kind: 'owner_unmatched', search: 'x' }], ['altoc', 'exceptions', { search: 'x' }], ['altoc', 'exceptions', { status: 'deleted' }],
      ['altoc', 'exceptions', { pageSize: '500' }], ['altoc', 'exceptions', { sourcePk: '1' }], ['altoc', 'identities', { kind: 'owner_unmatched' }],
      ['finance', 'identities', {}], ['altoc', 'identities', { status: 'open' }], ['altoc', 'exceptions', { kind: ['a'] }]
    ]) assert.throws(() => normalizeMigrationQueueRequest(app, view, query), { statusCode: 400 }, JSON.stringify([app, view, query]))
    assert.equal(migrationQueueKinds.altoc.some(kind => migrationQueueKinds.finance.includes(kind)), false)

    const expanded = normalizeMigrationQueueRequest('altoc', 'exceptions', { status: 'resolved,open', objectSearch: 'CT-W', createdFrom: '2026-01-01', createdTo: '2026-10-05', sort: 'created_desc', page: '2', pageSize: '50' })
    assert.equal(expanded.name, 'open,resolved')
    assert.deepEqual(expanded.migrationQuery, { objectSearch: 'CT-W', createdFrom: '2026-01-01', createdTo: '2026-10-05', sort: 'created_desc' })
    assert.equal(Object.hasOwn(normalizeMigrationQueueRequest('altoc', 'exceptions', {}), 'migrationQuery'), false, 'old reads keep their canonical bytes')
    for (const query of [{ createdFrom: '2026-02-30' }, { createdFrom: '2026-10-05', createdTo: '2026-01-01' }, { sort: 'sql' }, { eventsFor: 'identity:employee:7', kind: 'owner_unmatched' }, { eventsFor: 'exception:01' }]) assert.throws(() => normalizeMigrationQueueRequest('altoc', 'exceptions', query), { statusCode: 400 })
    assert.throws(() => normalizeMigrationQueueRequest('finance', 'exceptions', { eventsFor: 'identity:employee:7' }), { statusCode: 400 })
    // No permission: nothing reaches Runtime. Ledger not installed stays 503.
    const before = state.calls.length
    state.query = {}
    state.allowed = false
    await assert.rejects(enterpriseAltocMigrationExceptions({}), { statusCode: 403 })
    assert.equal(state.calls.length, before)
    state.allowed = true
    state.query = {}
    state.fail = 503
    await assert.rejects(enterpriseAltocMigrationExceptions({}), { statusCode: 503 })
    state.fail = 0
    // A malformed Runtime answer is not passed through.
    state.response = { code: 0, data: { data: 'rows', total: 1, page: 1, pageSize: 20 } }
    await assert.rejects(enterpriseAltocMigrationExceptions({}), { statusCode: 503 })
  } finally {
    hooks.deregister()
    delete globalThis.__queue
  }
})

test('migration queue writes: resolve action, closed commands, customer scope from the Host own authorization', async () => {
  const state = { calls: [], scoped: [], evaluated: [], permits: [], query: {}, body: {}, id: '11', sourceUserId: 'employee:7', allowed: true, key: 'stable-key' }
  globalThis.__queue = state
  const hooks = queueHooks()
  try {
    const { enterpriseAltocMigrationResolve, enterpriseFinanceMigrationResolve, enterpriseAltocMigrationIdentityConfirm, enterpriseAltocMigrationIdentityReject, normalizeMigrationResolve, normalizeMigrationIdentityDecision } = await import('../server/utils/enterpriseMigrationQueue.ts')
    // A plain state change: only the queue permission, no customer authorization.
    state.body = { expectedVersion: 2, method: 'accept', reason: '业务确认' }
    await enterpriseAltocMigrationResolve({})
    let [, op, body, options] = state.calls[0]
    assert.equal(op, 'altoc.w3-migration-exceptions-resolve')
    assert.deepEqual(body.migrationResolve, { id: '11', expectedVersion: 2, method: 'accept', reason: '业务确认', customerId: '', contactCode: '', accountCode: '', amount: '' })
    assert.deepEqual([body.authorization.resource, body.authorization.action, body.authorization.operation, body.authorization.objectId, body.authorization.scope.access], ['migration_exceptions', 'resolve', 'migration-exceptions-resolve', '11', 'all'])
    assert.equal(options.idempotencyKey, 'stable-key')
    assert.deepEqual(state.scoped[0], ['altoc', { resourceCode: 'migration_exceptions', action: 'resolve' }])
    assert.equal(state.permits.length, 0)

    // Touching a customer: the Host adds its own customer:edit scope; the browser cannot.
    state.body = { expectedVersion: 1, method: 'assign_customer', customerId: '7' }
    await enterpriseAltocMigrationResolve({})
    assert.deepEqual(state.calls[1][2].migrationResolve.customerScope, { access: 'self_dept', departmentCodes: ['D-1'] })
    assert.deepEqual(state.permits[0], ['altoc', 'save', undefined, undefined])
    // Without customer:edit nothing reaches Runtime.
    state.customerDenied = true
    await assert.rejects(enterpriseAltocMigrationResolve({}), { statusCode: 403 })
    assert.equal(state.calls.length, 2)
    state.customerDenied = false

    state.body = { expectedVersion: 1, method: 'accept' }
    state.id = '8'
    await enterpriseFinanceMigrationResolve({})
    assert.deepEqual([state.calls[2][1], state.scoped.at(-1)[0], state.evaluated.at(-1).appCode], ['finance.w3-migration-exceptions-resolve', 'finance', 'finance'])

    state.body = { expectedStatus: 'candidate', directoryUid: 'person-b' }
    await enterpriseAltocMigrationIdentityConfirm({})
    assert.deepEqual([state.calls[3][1], state.calls[3][2].migrationIdentity, state.calls[3][2].authorization.objectId], ['altoc.w3-migration-identities-confirm', { sourceUserId: 'employee:7', expectedStatus: 'candidate', directoryUid: 'person-b' }, 'employee:7'])
    state.body = { expectedStatus: 'candidate' }
    await enterpriseAltocMigrationIdentityReject({})
    assert.equal(state.calls[4][2].authorization.operation, 'migration-identities-reject')

    // Batch reassignment: both object scopes come from the Host's own authorization.
    state.body = {}
    const { enterpriseAltocMigrationIdentityApply, normalizeMigrationApply } = await import('../server/utils/enterpriseMigrationQueue.ts')
    const permitsBefore = state.permits.length
    await enterpriseAltocMigrationIdentityApply({})
    const apply = state.calls.at(-1)
    assert.deepEqual([apply[1], apply[2].authorization.operation, apply[2].authorization.objectId, apply[3].idempotencyKey], ['altoc.w3-migration-identities-apply', 'migration-identities-apply', 'employee:7', 'stable-key'])
    assert.deepEqual(apply[2].migrationApply, { sourceUserId: 'employee:7', limit: 100, customerScope: { access: 'self_dept', departmentCodes: ['D-1'] }, contractScope: { access: 'self_dept', departmentCodes: ['D-1'] } })
    assert.deepEqual(state.permits.slice(permitsBefore), [['altoc', 'save', undefined, undefined], ['altoc', 'save', 'contract', undefined]])
    for (const [id, body] of [['user:7', {}], ['7', {}], ['employee:7', { limit: 500 }], ['employee:7', { limit: 0 }], ['employee:7', { ownerUid: 'forged' }], ['employee:7', { customerScope: { access: 'all' } }]]) assert.throws(() => normalizeMigrationApply(id, {}, body), { statusCode: 400 }, JSON.stringify([id, body]))

    // Finance settles a balance item with an amount; Altoc cannot, and other methods carry no amount.
    assert.deepEqual(normalizeMigrationResolve('finance', '8', {}, { expectedVersion: 1, method: 'record_balance', accountCode: 'BA-W000001', amount: '-250.50' }), { id: '8', expectedVersion: 1, method: 'record_balance', reason: '', customerId: '', contactCode: '', accountCode: 'BA-W000001', amount: '-250.50' })
    for (const [app, body] of [['altoc', { expectedVersion: 1, method: 'record_balance', amount: '1.00' }], ['finance', { expectedVersion: 1, method: 'record_balance' }], ['finance', { expectedVersion: 1, method: 'record_balance', amount: 1 }], ['finance', { expectedVersion: 1, method: 'record_balance', amount: '1.001' }], ['finance', { expectedVersion: 1, method: 'accept', amount: '1.00' }], ['finance', { expectedVersion: 1, method: 'accept', accountCode: 'BA-1' }]]) assert.throws(() => normalizeMigrationResolve(app, '8', {}, body), { statusCode: 400 }, JSON.stringify(body))

    // Closed commands.
    for (const [app, body] of [
      ['altoc', { expectedVersion: 1, method: 'delete' }], ['altoc', { expectedVersion: 1, method: 'assign_customer' }], ['altoc', { expectedVersion: 1, method: 'accept', customerId: '7' }],
      ['altoc', { expectedVersion: 1, method: 'assign_customer', customerId: '7', customerScope: { access: 'all' } }], ['altoc', { expectedVersion: 1, method: 'assign_customer', customerId: '7', name: '伪造姓名' }],
      ['altoc', { expectedVersion: 1, method: 'link_existing', customerId: '7' }], ['altoc', { expectedVersion: 1, method: 'accept', contactCode: 'CN-1' }], ['altoc', { method: 'accept' }],
      ['altoc', { expectedVersion: 1.5, method: 'accept' }], ['finance', { expectedVersion: 1, method: 'assign_customer', customerId: '7' }], ['altoc', { expectedVersion: 1, method: 'accept', status: 'resolved' }]
    ]) assert.throws(() => normalizeMigrationResolve(app, '11', {}, body), { statusCode: 400 }, JSON.stringify(body))
    assert.throws(() => normalizeMigrationResolve('altoc', 'x', {}, { expectedVersion: 1, method: 'accept' }), { statusCode: 400 })
    assert.throws(() => normalizeMigrationResolve('altoc', '11', { force: '1' }, { expectedVersion: 1, method: 'accept' }), { statusCode: 400 })
    for (const [decision, id, body] of [
      ['confirm', '7', { expectedStatus: 'candidate', directoryUid: 'person-b' }], ['confirm', 'employee:7', { expectedStatus: 'candidate' }], ['confirm', 'employee:7', { expectedStatus: 'candidate', directoryUid: 'system:unassigned' }],
      ['confirm', 'employee:7', { expectedStatus: 'confirmed', directoryUid: 'person-b' }], ['reject', 'employee:7', { expectedStatus: 'candidate', directoryUid: 'person-b' }], ['reject', 'employee:7', { expectedStatus: 'rejected' }],
      ['confirm', 'employee:7', { expectedStatus: 'candidate', directoryUid: 'person-b', matchedBy: 'forged' }]
    ]) assert.throws(() => normalizeMigrationIdentityDecision(decision, id, {}, body), { statusCode: 400 }, JSON.stringify([decision, id, body]))

    // No resolve permission or no idempotency key: nothing reaches Runtime.
    const before = state.calls.length
    state.body = { expectedVersion: 2, method: 'accept', reason: 'x' }
    state.allowed = false
    await assert.rejects(enterpriseAltocMigrationResolve({}), { statusCode: 403 })
    state.allowed = true
    state.key = ''
    await assert.rejects(enterpriseAltocMigrationResolve({}), { statusCode: 400 })
    assert.equal(state.calls.length, before)
    state.key = 'stable-key'
    // Runtime conflicts keep their status.
    for (const status of [404, 409, 503]) {
      state.fail = status
      await assert.rejects(enterpriseAltocMigrationResolve({}), { statusCode: status })
    }
  } finally {
    hooks.deregister()
    delete globalThis.__queue
  }
})

test('queue kinds and resources agree between Host, Runtime and manifests', () => {
  const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')
  const go = read('../../data-runtime/internal/enterpriseapf/migration_queue.go')
  const runtime = Object.fromEntries([...go.matchAll(/"([a-z_]+)":\s+\{"(altoc|finance)", \[\]string\{/g)].map(m => [m[1], m[2]]))
  const host = read('../server/utils/enterpriseMigrationQueue.ts')
  for (const app of ['altoc', 'finance']) {
    const kinds = [...host.slice(host.indexOf(`${app}: [`), host.indexOf(']', host.indexOf(`${app}: [`))).matchAll(/'([a-z_]+)'/g)].map(m => m[1]).sort()
    assert.deepEqual(kinds, Object.keys(runtime).filter(kind => runtime[kind] === app).sort(), app)
    const manifest = JSON.parse(read(`../../${app}/app.manifest.json`))
    assert.deepEqual(manifest.resources.find(resource => resource.code === 'migration_exceptions')?.actions, ['view', 'resolve'])
    const holders = manifest.recommendedRoles.filter(role => role.suggestedPermissions.some(p => p.startsWith(`${app}:migration_exceptions:`))).map(role => role.code)
    assert.deepEqual(holders, [`${app}:admin`])
  }
  assert.equal(runtime.contract_contact_mismatch, 'altoc')
  assert.equal(Object.keys(runtime).length, 10)
  // The Host never touches ledger tables or row JSON itself.
  assert.equal(/mig_|row_json|detail_json/.test(host), false)
})
