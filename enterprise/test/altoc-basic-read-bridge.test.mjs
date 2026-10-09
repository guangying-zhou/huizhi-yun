import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { registerHooks } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createApp, createRouter, defineEventHandler, toNodeListener } from 'h3'

test('twelve Altoc Host GET handlers use current scoped Console evidence and safe projections', async () => {
  const root = resolve(import.meta.dirname, '../..'), calls = [], checks = [], directories = []
  let override = {}, runtimeFailure = 0, sessionValid = true, rawExtra = {}, denySnapshot = false, badShape = false, directoryDown = false
  const session = { authenticated: true, tokenUse: 'access', subjectType: 'user', uid: 'person-a', tenant: 'tenant-a', deployment: 'enterprise-test' }
  let customerDenied = false, customerUnavailable = false
  let customerContacts = []
  let quoteItems = [{ id: 1, quotation_id: 7, item_name: 'safe', cost_price: 'LEAK', context: 'LEAK' }]
  const oldConfig = globalThis.useRuntimeConfig
  globalThis.useRuntimeConfig = () => ({ public: { appCode: 'enterprise' } })
  globalThis.__sol2AltocSession = () => sessionValid ? session : { authenticated: false }
  globalThis.__sol2AltocSnapshot = async () => ({ resources: denySnapshot ? {} : { customer: ['view'], contract: ['view'], receivable: ['view'], lead: ['view'], opportunity: ['view'], quotation: ['view'] } })
  globalThis.__sol2AltocScoped = async (_event, uid, appCode, required) => {
    checks.push({ uid, appCode, required })
    if (required.resourceCode === 'customer' && customerUnavailable) throw Object.assign(new Error('dependency'), { statusCode: 503 })
    if (required.resourceCode === 'customer' && customerDenied) return { uid, appCode, roles: [], bundleVersion: 'v1', bundleHash: 'hash', policyRevision: 42, authorizationExpiresAt: Date.now() + 14000, grants: [] }
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
    const children = Object.fromEntries(['lines', 'payment_terms', 'obligations', 'billing_schedules', 'project_links'].map(key => [key, [{ id: 1, name: 'child', context: 'LEAK', url: 'LEAK' }]]))
    return { handled: true, data: { code: 0, data: badShape ? { items: [], total: -1 } : path.endsWith(':list') ? { items: [row], total: 25, page: options.body.query.page, pageSize: options.body.query.pageSize, debug: 'LEAK' } : { ...row, ...children, contacts: customerContacts, invoice_profiles: [], items: quoteItems, job: 'LEAK' } } }
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
    app.use(defineEventHandler((event) => {
      event.context.consoleAuth = session
    }))
    for (const [folder, param] of [['customers', 'customerId'], ['contracts', 'contractId'], ['payments', 'planId'], ['leads', 'leadId'], ['opportunities', 'opportunityId'], ['quotes', 'quotationId']]) {
      router.get(`/altoc/api/v1/${folder}`, (await import(`../server/routes/altoc/api/v1/${folder}/index.get.ts`)).default)
      router.get(`/altoc/api/v1/${folder}/:${param}`, (await import(`../server/routes/altoc/api/v1/${folder}/[${param}].get.ts`)).default)
    }
    app.use(router)
    server = createServer(toNodeListener(app))
    await new Promise(done => server.listen(0, '127.0.0.1', done))
    const base = `http://127.0.0.1:${server.address().port}`
    for (const [folder, resource, runtime] of [['customers', 'customer', 'customers'], ['contracts', 'contract', 'contracts'], ['payments', 'receivable', 'receivable-plans'], ['leads', 'lead', 'leads'], ['opportunities', 'opportunity', 'opportunities'], ['quotes', 'quotation', 'quotations']]) for (const suffix of ['', '/7']) {
      const response = await fetch(`${base}/altoc/api/v1/${folder}${suffix}`)
      assert.equal(response.status, 200)
      assert.equal(response.headers.get('cache-control'), 'private, no-store')
      const result = await response.json()
      assert.ok(!JSON.stringify(result).includes('LEAK'))
      const request = calls.at(-1), permit = request.options.body.authorization
      assert.equal(request.path, `/v1/enterprise/altoc/${runtime}:${suffix ? 'view' : 'list'}`)
      assert.equal(request.options.scope, 'altoc:enterprise-host:execute')
      assert.equal(request.options.appCode, 'enterprise')
      assert.equal(request.options.idempotencyKey, undefined)
      assert.deepEqual(permit.query, request.options.body.query)
      assert.equal(permit.actorUid, session.uid)
      assert.equal(permit.tenant, session.tenant)
      assert.equal(permit.deployment, session.deployment)
      assert.equal(permit.resource, resource)
      assert.equal(permit.operation, suffix ? 'view' : 'list')
      assert.equal(permit.objectId, suffix ? '7' : '')
      assert.equal(permit.bundleHash, 'hash')
      assert.equal(permit.policyRevision, 42)
      assert.deepEqual(permit.scope, { access: 'self', departmentCodes: [] })
      assert.ok(permit.expiresAt > Date.now() && permit.expiresAt <= Date.now() + 14000)
    }
    const contractPermit = calls.find(call => call.path === '/v1/enterprise/altoc/contracts:list').options.body.authorization
    assert.equal(contractPermit.customerRead.resource, 'customer')
    assert.deepEqual(contractPermit.customerRead.scope, { access: 'self', departmentCodes: [] })
    assert.equal(contractPermit.customerRead.expiresAt, contractPermit.expiresAt)
    customerDenied = true
    assert.equal((await fetch(base + '/altoc/api/v1/contracts')).status, 200)
    assert.equal(calls.at(-1).options.body.authorization.customerRead, undefined)
    customerDenied = false
    customerUnavailable = true
    const beforeDependency = calls.length
    assert.equal((await fetch(base + '/altoc/api/v1/contracts')).status, 503)
    assert.equal(calls.length, beforeDependency)
    customerUnavailable = false
    for (const [path, expected] of [
      ['/customers?parentId=7&ownerUnassigned=true', { parentId: '7', ownerUnassigned: true }],
      ['/customers?rootsOnly=true', { rootsOnly: true }],
      ['/contracts?origin=historical_import&category=software_development&ownerUnassigned=true', { origin: 'historical_import', category: 'software_development', ownerUnassigned: true }],
      ['/contracts?customerId=7&includeDescendants=true', { customerId: '7', includeDescendants: true }],
      ['/contracts?parentContractId=7', { parentContractId: '7' }],
      ['/contracts?customerIds=2,3', { customerIds: '2,3' }],
      ['/contracts?ownerUid=person-a&amountMin=10.01&amountMax=99.99&direction=sales&contractType=service', { ownerUid: 'person-a', amountMin: '10.01', amountMax: '99.99', direction: 'sales', contractType: 'service' }],
      ['/contracts?signedDateFrom=2024-02-29&signedDateTo=2026-12-31', { signedDateFrom: '2024-02-29', signedDateTo: '2026-12-31' }]
    ]) {
      assert.equal((await fetch(base + '/altoc/api/v1' + path)).status, 200)
      const query = calls.at(-1).options.body.query
      assert.deepEqual(query, calls.at(-1).options.body.authorization.query)
      for (const [key, value] of Object.entries(expected)) assert.equal(query[key], value)
    }
    for (const path of ['/contracts?amountMin=-1', '/contracts?amountMin=10&amountMax=1', '/contracts?ownerUid=person&ownerUnassigned=true', '/contracts?direction=unknown', '/customers?amountMin=1', '/customers?parentId=0', '/customers?parentId=7&rootsOnly=true', '/customers?rootsOnly=yes', '/contracts?origin=unknown', '/contracts?parentId=7', '/contracts?includeDescendants=true', '/customers?origin=native', '/contracts?parentContractId=01', '/contracts?customerIds=2,2', '/contracts?customerIds=2,3&customerId=7', '/contracts?customerIds=2,3&includeDescendants=true', '/customers?customerIds=2', '/contracts?signedDateFrom=2026-02-30', '/contracts?signedDateFrom=2026-12-31&signedDateTo=2026-01-01', '/contracts?signedDateTo=', '/customers?signedDateFrom=2026-01-01', '/contracts/7?signedDateFrom=2026-01-01']) {
      const count = calls.length
      assert.equal((await fetch(base + '/altoc/api/v1' + path)).status, 400, path)
      assert.equal(calls.length, count)
    }
    rawExtra = { customer_level_id: null, customer_level_name: 'Reviewed grade', childCount: 1, hasHiddenChildren: true, hiddenChildCount: 987, hiddenCustomerCount: 987, migration_snapshot: { contract_count_direct: null, contract_amount_direct: '20.00', row_json: 'LEAK' }, source_info: { system: 'wizbiz', table: 'wb_organization', pk: '7', batchCode: 'W1', importedAt: '2024-01-31', row_json: 'LEAK' }, source_owner_name: 'Original owner', ancestors: [{ id: 1, name: 'Parent', secret: 'LEAK' }], parent: { id: 1, name: 'Parent', secret: 'LEAK' } }
    const w3 = await (await fetch(base + '/altoc/api/v1/customers/7')).json()
    assert.equal(w3.data.migration_snapshot.contract_count_direct, null)
    assert.equal(w3.data.customer_level_id, null)
    assert.equal(w3.data.customer_level_name, 'Reviewed grade')
    assert.equal(w3.data.source_info.table, 'wb_organization')
    assert.deepEqual({ childCount: w3.data.childCount, hasHiddenChildren: w3.data.hasHiddenChildren }, JSON.parse(readFileSync(new URL('./fixtures/w3-customer-visibility.json', import.meta.url), 'utf8')))
    assert.ok(!Object.keys(w3.data).some(key => /hidden.*count|count.*hidden/i.test(key)))
    const w3List = await (await fetch(base + '/altoc/api/v1/customers')).json()
    assert.equal(w3List.data.items[0].hasHiddenChildren, true)
    assert.ok(!Object.keys(w3List.data.items[0]).some(key => /hidden.*count|count.*hidden/i.test(key)))
    assert.deepEqual(w3.data.ancestors, [{ id: 1, name: 'Parent' }])
    assert.ok(!JSON.stringify(w3).includes('LEAK'))
    customerContacts = [{ id: 1, code: 'CN-SYNTHETIC', customer_id: 7, source_info: { system: 'wizbiz', table: 'wb_contactman', pk: '1', batchCode: 'B6', importedAt: '2024-01-31', row_json: 'LEAK' } }]
    const contactRead = await (await fetch(base + '/altoc/api/v1/customers/7')).json()
    assert.equal(contactRead.data.contacts[0].source_info.table, 'wb_contactman')
    assert.ok(!JSON.stringify(contactRead).includes('LEAK'))
    customerContacts = []
    rawExtra = { hasHiddenChildren: 2 }
    assert.equal((await fetch(base + '/altoc/api/v1/customers/7')).status, 503)
    rawExtra = {}
    assert.ok(checks.every(check => check.uid === 'person-a' && check.appCode === 'altoc' && check.required.action === 'view'))
    for (const path of ['/customers?actorUid=forged', '/contracts?authorization=x', '/payments?departmentCodes=D', '/contracts?metric=received', '/customers?page=0', '/customers?pageSize=101', '/customers?search=x&search=y', '/customers?status=' + encodeURIComponent('中'.repeat(14)), '/customers/0', '/customers/9007199254740993', '/contracts/7?search=x', '/customers?customerId=7', '/contracts?contractId=7']) {
      const before = calls.length
      assert.equal((await fetch(base + '/altoc/api/v1' + path)).status, 400, path)
      assert.equal(calls.length, before)
    }
    for (const folder of ['leads', 'opportunities', 'quotes']) {
      denySnapshot = true
      const before = calls.length
      assert.equal((await fetch(base + `/altoc/api/v1/${folder}`)).status, 403)
      assert.equal((await fetch(base + `/altoc/api/v1/${folder}/7`)).status, 403)
      assert.equal(calls.length, before)
      denySnapshot = false
    }
    assert.equal((await fetch(base + '/altoc/api/v1/quotes?opportunityId=8&customerId=9')).status, 200)
    assert.equal(calls.at(-1).options.body.authorization.query.opportunityId, '8')
    for (const path of ['/leads?customerId=1', '/opportunities?opportunityId=1', '/quotes?contractId=1', '/quotes?opportunityId=01', '/quotes/7?opportunityId=1']) assert.equal((await fetch(base + '/altoc/api/v1' + path)).status, 400)
    customerContacts = [{ id: 1, customer_id: 8, name: 'foreign', code: 'CN-test' }]
    assert.equal((await fetch(base + '/altoc/api/v1/customers/7')).status, 503)
    customerContacts = [{ id: 1, customer_id: 7, name: 'safe', code: 'CN-test', secret: 'LEAK' }]
    const customerRead = await fetch(base + '/altoc/api/v1/customers/7')
    assert.equal(customerRead.status, 200)
    assert.equal(JSON.stringify(await customerRead.json()).includes('LEAK'), false)
    customerContacts = []
    quoteItems = [{ id: 1, quotation_id: 8 }]
    assert.equal((await fetch(base + '/altoc/api/v1/quotes/7')).status, 503)
    quoteItems = Array.from({ length: 1001 }, (_, i) => ({ id: i + 1, quotation_id: 7 }))
    assert.equal((await fetch(base + '/altoc/api/v1/quotes/7')).status, 503)
    quoteItems = [{ id: 1, quotation_id: 7, item_name: 'safe' }]
    for (const [state, expected] of [[{ uid: 'other' }, 503], [{ appCode: 'aims' }, 503], [{ bundleHash: '' }, 503], [{ policyRevision: undefined }, 503], [{ authorizationExpiresAt: Date.now() - 1 }, 503], [{ grants: [] }, 403]]) {
      override = state
      const before = calls.length
      assert.equal((await fetch(base + '/altoc/api/v1/customers')).status, expected)
      assert.equal(calls.length, before)
    }
    override = {}
    denySnapshot = true
    assert.equal((await fetch(base + '/altoc/api/v1/customers')).status, 403)
    denySnapshot = false
    sessionValid = false
    assert.equal((await fetch(base + '/altoc/api/v1/customers')).status, 401)
    sessionValid = true
    const grant = scopes => ({ permissions: [{ appCode: 'altoc', resourceCode: 'customer', action: 'view' }], scopes })
    override = { grants: [grant([{ dimension: 'department', predicate: 'tree', value: 'D-1' }])] }
    assert.equal((await fetch(base + '/altoc/api/v1/customers')).status, 200)
    assert.deepEqual(calls.at(-1).options.body.authorization.scope, { access: 'dept', departmentCodes: ['D-1', 'D-2'] })
    override = { grants: [grant([{ dimension: 'department', predicate: 'self' }])] }
    assert.equal((await fetch(base + '/altoc/api/v1/customers')).status, 200)
    assert.deepEqual(calls.at(-1).options.body.authorization.scope, { access: 'dept', departmentCodes: ['D-1'] })
    directoryDown = true
    assert.equal((await fetch(base + '/altoc/api/v1/customers')).status, 503)
    directoryDown = 404
    assert.equal((await fetch(base + '/altoc/api/v1/customers')).status, 503, 'missing directory source is a dependency failure')
    directoryDown = false
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
      const body = await response.text()
      assert.ok(!body.includes('secret') && !body.includes('SELECT'))
    }
    runtimeFailure = 0
    rawExtra = { name: { secret: 'LEAK' } }
    assert.equal((await fetch(base + '/altoc/api/v1/contracts/7')).status, 503)
    rawExtra = {}
    badShape = true
    assert.equal((await fetch(base + '/altoc/api/v1/customers')).status, 503)
  } finally {
    if (server) await new Promise(done => server.close(done))
    hooks.deregister()
    globalThis.useRuntimeConfig = oldConfig
    for (const key of ['Session', 'Snapshot', 'Scoped', 'Directory', 'Transport']) delete globalThis['__sol2Altoc' + key]
  }
})
