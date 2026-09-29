import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createApp, createRouter, defineEventHandler, toNodeListener } from 'h3'

test('twelve Altoc Host GET handlers use current scoped Console evidence and safe projections', async () => {
  const root = resolve(import.meta.dirname, '../..'), calls = [], checks = [], directories = []
  let override = {}, runtimeFailure = 0, sessionValid = true, rawExtra = {}, denySnapshot = false, badShape = false, directoryDown = false
  const session = { authenticated: true, tokenUse: 'access', subjectType: 'user', uid: 'person-a', tenant: 'tenant-a', deployment: 'enterprise-test' }
  let quoteItems = [{id:1,quotation_id:7,item_name:'safe',cost_price:'LEAK',context:'LEAK'}]
  const oldConfig = globalThis.useRuntimeConfig
  globalThis.useRuntimeConfig = () => ({ public: { appCode: 'enterprise' } })
  globalThis.__sol2AltocSession = () => sessionValid ? session : { authenticated: false }
  globalThis.__sol2AltocSnapshot = async () => ({ resources: denySnapshot ? {} : { customer: ['view'], contract: ['view'], receivable: ['view'], lead:['view'], opportunity:['view'], quotation:['view'] } })
  globalThis.__sol2AltocScoped = async (_event, uid, appCode, required) => {
    checks.push({ uid, appCode, required })
    return { uid, appCode, roles: [], bundleVersion: 'v1', bundleHash: 'hash', policyRevision: 42, authorizationExpiresAt: Date.now() + 14000,
      grants: [{ grantId: 'read', permissions: [{ appCode, resourceCode: required.resourceCode, action: 'view' }], scopes: [{ dimension: 'subject', predicate: 'self' }] }], ...override }
  }
  globalThis.__sol2AltocDirectory = async (path, options) => {
    directories.push({ path, options })
    if (directoryDown) throw Object.assign(new Error('private directory secret'), { statusCode: typeof directoryDown === 'number' ? directoryDown : 503 })
    return path === '/user-departments' ? { code: 0, data: { primaryDeptCode: 'D-1', departments: [{ deptCode: 'D-1' }] } } : { code: 0, data: { tree: [{ deptCode: 'D-1', children: [{ deptCode: 'D-2' }] }] } }
  }
  globalThis.__sol2AltocTransport = async (_event, path, options) => {
    calls.push({ path, options })
    if (runtimeFailure) throw Object.assign(new Error('SELECT password secret'), { statusCode: runtimeFailure })
    const row = { id: 7, code: 'SAFE', name: '客户合同', plan_name: '回款', status: 'active', amount: '25.00', password: 'LEAK', scan_url: 'LEAK', invoice_infos: { bank: 'LEAK' }, customer_name: 'LEAK', finance: { secret: 'LEAK' }, ...rawExtra }
    const children = Object.fromEntries(['lines', 'payment_terms', 'obligations', 'billing_schedules'].map(key => [key, [{ id: 1, name: 'child', context: 'LEAK', url: 'LEAK' }]]))
    return { handled: true, data: { code: 0, data: badShape ? { items: [], total: -1 } : path.endsWith(':list') ? { items: [row], total: 25, page: options.body.query.page, pageSize: options.body.query.pageSize, debug: 'LEAK' } : { ...row, ...children, items:quoteItems, job: 'LEAK' } } }
  }
  const hooks = registerHooks({ resolve(specifier, context, next) {
    let source
    if (specifier.endsWith('/consoleSessionBridge') || specifier === './consoleSessionBridge') source = 'export const resolveConsoleAuthWithSessionBridge=async()=>globalThis.__sol2AltocSession()'
    if (specifier.endsWith('/platformBundleAuthorization')) source = 'export const loadScopedAuthorizationFromConsoleRuntime=(...args)=>globalThis.__sol2AltocScoped(...args);export const loadAuthorizationSnapshotFromConsoleRuntime=(...args)=>globalThis.__sol2AltocSnapshot(...args)'
    if (specifier.endsWith('/directoryApi')) source = 'export const fetchConsoleDirectoryApi=(...args)=>globalThis.__sol2AltocDirectory(...args)'
    if (specifier.endsWith('/tenantRuntimeClient') || specifier === './tenantRuntimeClient') source = 'export const maybeCallTenantRuntime=(...args)=>globalThis.__sol2AltocTransport(...args);export const verifiedServiceCommandActor=()=>null;export const prepareTenantRuntime=async()=>true'
    if (source) return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true }
    let candidate
    if (specifier.startsWith('@hzy/foundation/')) candidate = resolve(root, 'foundation', specifier.slice('@hzy/foundation/'.length))
    else if (specifier.startsWith('~~/')) candidate = resolve(root, 'enterprise', specifier.slice(3))
    else if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) candidate = resolve(dirname(fileURLToPath(context.parentURL)), specifier)
    if (candidate && !existsSync(candidate) && existsSync(candidate + '.ts')) return { url: pathToFileURL(candidate + '.ts').href, shortCircuit: true }
    return next(specifier, context)
  } })
  let server
  try {
    const app = createApp(), router = createRouter()
    app.use(defineEventHandler(event => { event.context.consoleAuth = session }))
    for (const [folder, param] of [['customers', 'customerId'], ['contracts', 'contractId'], ['payments', 'planId'], ['leads','leadId'], ['opportunities','opportunityId'], ['quotes','quotationId']]) {
      router.get(`/altoc/api/v1/${folder}`, (await import(`../server/routes/altoc/api/v1/${folder}/index.get.ts`)).default)
      router.get(`/altoc/api/v1/${folder}/:${param}`, (await import(`../server/routes/altoc/api/v1/${folder}/[${param}].get.ts`)).default)
    }
    app.use(router); server = createServer(toNodeListener(app)); await new Promise(done => server.listen(0, '127.0.0.1', done))
    const base = `http://127.0.0.1:${server.address().port}`
    for (const [folder, resource, runtime] of [['customers', 'customer', 'customers'], ['contracts', 'contract', 'contracts'], ['payments', 'receivable', 'receivable-plans'], ['leads','lead','leads'], ['opportunities','opportunity','opportunities'], ['quotes','quotation','quotations']]) for (const suffix of ['', '/7']) {
      const response = await fetch(`${base}/altoc/api/v1/${folder}${suffix}`)
      assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'private, no-store')
      const result = await response.json(); assert.ok(!JSON.stringify(result).includes('LEAK'))
      const request = calls.at(-1), permit = request.options.body.authorization
      assert.equal(request.path, `/v1/enterprise/altoc/${runtime}:${suffix ? 'view' : 'list'}`)
      assert.equal(request.options.scope, 'altoc:enterprise-host:execute')
      assert.equal(request.options.appCode, 'enterprise'); assert.equal(request.options.idempotencyKey, undefined)
      assert.deepEqual(permit.query, request.options.body.query)
      assert.equal(permit.actorUid, session.uid); assert.equal(permit.tenant, session.tenant); assert.equal(permit.deployment, session.deployment)
      assert.equal(permit.resource, resource); assert.equal(permit.operation, suffix ? 'view' : 'list'); assert.equal(permit.objectId, suffix ? '7' : '')
      assert.equal(permit.bundleHash, 'hash'); assert.equal(permit.policyRevision, 42); assert.deepEqual(permit.scope, { access: 'self', departmentCodes: [] })
      assert.ok(permit.expiresAt > Date.now() && permit.expiresAt <= Date.now() + 14000)
    }
    assert.ok(checks.every(check => check.uid === 'person-a' && check.appCode === 'altoc' && check.required.action === 'view'))
    for (const path of ['/customers?actorUid=forged', '/contracts?authorization=x', '/payments?departmentCodes=D', '/contracts?metric=received', '/customers?page=0', '/customers?pageSize=101', '/customers?search=x&search=y', '/customers?status='+encodeURIComponent('中'.repeat(14)), '/customers/0', '/customers/9007199254740993', '/contracts/7?search=x', '/customers?customerId=7', '/contracts?contractId=7']) {
      const before = calls.length
      assert.equal((await fetch(base + '/altoc/api/v1' + path)).status, 400, path); assert.equal(calls.length, before)
    }
    for (const folder of ['leads','opportunities','quotes']) {
      denySnapshot = true; const before = calls.length
      assert.equal((await fetch(base + `/altoc/api/v1/${folder}`)).status, 403)
      assert.equal((await fetch(base + `/altoc/api/v1/${folder}/7`)).status, 403)
      assert.equal(calls.length, before); denySnapshot = false
    }
    assert.equal((await fetch(base+'/altoc/api/v1/quotes?opportunityId=8&customerId=9')).status,200)
    assert.equal(calls.at(-1).options.body.authorization.query.opportunityId,'8')
    for (const path of ['/leads?customerId=1','/opportunities?opportunityId=1','/quotes?contractId=1','/quotes?opportunityId=01','/quotes/7?opportunityId=1']) assert.equal((await fetch(base+'/altoc/api/v1'+path)).status,400)
    quoteItems = [{ id:1, quotation_id:8 }]
    assert.equal((await fetch(base+'/altoc/api/v1/quotes/7')).status,503)
    quoteItems = Array.from({length:1001},(_,i)=>({id:i+1,quotation_id:7}))
    assert.equal((await fetch(base+'/altoc/api/v1/quotes/7')).status,503)
    quoteItems = [{id:1,quotation_id:7,item_name:'safe'}]
    for (const [state, expected] of [[{ uid: 'other' }, 503], [{ appCode: 'aims' }, 503], [{ bundleHash: '' }, 503], [{ policyRevision: undefined }, 503], [{ authorizationExpiresAt: Date.now() - 1 }, 503], [{ grants: [] }, 403]]) {
      override = state; const before = calls.length
      assert.equal((await fetch(base + '/altoc/api/v1/customers')).status, expected); assert.equal(calls.length, before)
    }
    override = {}; denySnapshot = true
    assert.equal((await fetch(base + '/altoc/api/v1/customers')).status, 403)
    denySnapshot = false; sessionValid = false
    assert.equal((await fetch(base + '/altoc/api/v1/customers')).status, 401); sessionValid = true
    const grant = scopes => ({ permissions: [{ appCode: 'altoc', resourceCode: 'customer', action: 'view' }], scopes })
    override = { grants: [grant([{ dimension: 'department', predicate: 'tree', value: 'D-1' }])] }
    assert.equal((await fetch(base + '/altoc/api/v1/customers')).status, 200)
    assert.deepEqual(calls.at(-1).options.body.authorization.scope, { access: 'dept', departmentCodes: ['D-1', 'D-2'] })
    override = { grants: [grant([{ dimension: 'department', predicate: 'self' }])] }
    assert.equal((await fetch(base + '/altoc/api/v1/customers')).status, 200)
    assert.deepEqual(calls.at(-1).options.body.authorization.scope, { access: 'dept', departmentCodes: ['D-1'] })
    directoryDown = true
    assert.equal((await fetch(base + '/altoc/api/v1/customers')).status, 503); directoryDown = 404
    assert.equal((await fetch(base + '/altoc/api/v1/customers')).status, 503, 'missing directory source is a dependency failure'); directoryDown = false
    override = { grants: [grant([{ dimension: 'department', predicate: 'self', value: 'D-1' }, { dimension: 'subject', predicate: 'self' }])] }
    assert.equal((await fetch(base + '/altoc/api/v1/customers')).status, 200)
    assert.equal(calls.at(-1).options.body.authorization.scope.access, 'self_dept')
    override = { roles: ['system_admin'], grants: [] }
    assert.equal((await fetch(base + '/altoc/api/v1/customers')).status, 200)
    assert.deepEqual(calls.at(-1).options.body.authorization.scope, { access: 'all', departmentCodes: [] })
    override = { grants: [grant([{ dimension: 'unknown', predicate: 'global' }])] }
    assert.equal((await fetch(base + '/altoc/api/v1/customers')).status, 403)
    override = {}
    for (const status of [403, 404, 503, 500]) {
      runtimeFailure = status
      const response = await fetch(base + '/altoc/api/v1/contracts/7')
      assert.equal(response.status, status === 500 ? 503 : status)
      const body = await response.text(); assert.ok(!body.includes('secret') && !body.includes('SELECT'))
    }
    runtimeFailure = 0; rawExtra = { name: { secret: 'LEAK' } }
    assert.equal((await fetch(base + '/altoc/api/v1/contracts/7')).status, 503)
    rawExtra = {}; badShape = true
    assert.equal((await fetch(base + '/altoc/api/v1/customers')).status, 503)
  } finally {
    if (server) await new Promise(done => server.close(done))
    hooks.deregister(); globalThis.useRuntimeConfig = oldConfig
    for (const key of ['Session', 'Snapshot', 'Scoped', 'Directory', 'Transport']) delete globalThis['__sol2Altoc'+key]
  }
})
