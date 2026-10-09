import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

test('APF BFF binds fresh scope, exact bank admin and stable write intent; rejects malformed inputs before Runtime', async () => {
  const root = resolve(import.meta.dirname, '../..')
  const calls = []
  let allowed = true, sourceFailed = false
  globalThis.__apf = { calls, body: {}, query: {}, key: 'marked-key', allowed: () => allowed, failed: () => sourceFailed }
  const hooks = registerHooks({ resolve(specifier, context, next) {
    let source
    if (specifier === 'h3') source = `export const createError=x=>Object.assign(new Error('fixed'),x);export const getQuery=()=>globalThis.__apf.query;export const getHeader=()=>globalThis.__apf.key;export const readBody=async()=>globalThis.__apf.body;export const setHeader=()=>{}`
    if (specifier.endsWith('/enterpriseRuntimeClient')) source = `export const requireEnterpriseUser=async()=>({uid:'Person',tenant:'C000001',deployment:'Host'});export const prepareEnterpriseRuntime=async()=>true;export const enterpriseRuntimePermitExpiresAt=()=>Date.now()+14000;export const callEnterpriseRuntime=async(...args)=>{globalThis.__apf.calls.push(args);return globalThis.__apf.response || {code:0}}`
    if (specifier.endsWith('/enterpriseRuntimeChannels')) source = `export const callEnterpriseNotificationRuntime=async()=>({code:0,data:{allowed:true}})`
    if (specifier.endsWith('/tenantRuntimeClient')) source = `export const prepareTenantRuntime=async()=>true`
    if (specifier.endsWith('/platformBundleAuthorization')) source = `export const loadScopedAuthorizationFromConsoleRuntime=async(_e,uid,appCode,required)=>{if(globalThis.__apf.failed())throw Object.assign(new Error('dependency'),{statusCode:503});globalThis.__apf.required=required;return {uid,appCode,bundleVersion:'1',bundleHash:'hash',policyRevision:1,authorizationExpiresAt:Date.now()+14000,grants:[],roles:[]}}`
    if (specifier.endsWith('/scopeEvaluator')) source = `export const evaluateFoundationScopedAuthorization=()=>({allowed:globalThis.__apf.allowed()})`
    if (specifier.endsWith('/directoryApi')) source = `export const fetchConsoleDirectoryApi=async()=>{throw new Error('unexpected directory dependency')}`
    if (specifier.endsWith('/notificationDetailAuthorization')) source = `export const parseNotificationDetailAuthorizationRequest=x=>x;export const requireNotificationDetailAuthorizationCaller=async()=>({tenantId:'C000001'})`
    if (specifier.endsWith('/tenantGatewayTrust')) source = `export const resolveTrustedTenantGatewayContext=()=>null`
    if (source) return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true }
    let candidate
    if (specifier.startsWith('@hzy/foundation/')) candidate = resolve(root, 'foundation', specifier.slice('@hzy/foundation/'.length))
    else if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) candidate = resolve(dirname(fileURLToPath(context.parentURL)), specifier)
    if (candidate && !existsSync(candidate) && existsSync(`${candidate}.ts`)) return { url: pathToFileURL(`${candidate}.ts`).href, shortCircuit: true }
    return next(specifier, context)
  } })
  try {
    const { normalizeAPFInput, enterpriseAPFUser } = await import('../server/utils/enterpriseAPF.ts')
    globalThis.__apf.body = { code: 'MARKED', name: 'isolated' }
    await enterpriseAPFUser({}, 'finance', 'save')
    await enterpriseAPFUser({}, 'finance', 'save')
    assert.deepEqual(globalThis.__apf.required, { resourceCode: 'bank_accounts', action: 'admin' })
    assert.equal(calls.length, 2)
    assert.equal(calls[0][1], 'finance.bank-account-save')
    assert.equal(calls[0][3].idempotencyKey, calls[1][3].idempotencyKey)
    assert.equal(calls[0][2].authorization.actorUid, 'Person')
    allowed = false
    await assert.rejects(enterpriseAPFUser({}, 'finance', 'save'), { statusCode: 403 })
    assert.equal(calls.length, 2)
    allowed = true
    sourceFailed = true
    await assert.rejects(enterpriseAPFUser({}, 'people', 'list'), { statusCode: 503 })
    sourceFailed = false
    const position = { id: '1', position_code: 'CLAUDEFIX01', position_name: '标记岗位', job_family: 'P', description: '标记', enabled: 1, sort_order: 2, row_version: 3 }
    globalThis.__apf.response = { code: 0, data: { items: [position], total: 1 } }
    const result = await enterpriseAPFUser({}, 'people', 'list')
    assert.deepEqual(result.data.items[0], position)
    assert.deepEqual(globalThis.__apf.required, { resourceCode: 'positions', action: 'view' })
    assert.equal(calls.at(-1)[1], 'people.position-list')
    for (const bad of [{ page: [] }, { name: {} }, { id: '01' }, { name: 'x\n' }, { arbitrary: 'x' }]) assert.throws(() => normalizeAPFInput('finance', 'save', bad), { statusCode: 400 })
    assert.equal(normalizeAPFInput('finance', 'save', { id: '1', code: 'MARKED', name: 'edited', expectedVersion: 2 }).rowVersion, 2)
    assert.throws(() => normalizeAPFInput('finance', 'save', { id: '1', code: 'MARKED', name: 'edited', rowVersion: 2 }), { statusCode: 400 })
    assert.throws(() => normalizeAPFInput('people', 'save', { code: 'x', name: 'x' }), { statusCode: 403 })
    assert.throws(() => normalizeAPFInput('constructor', 'view', { id: '1' }), { statusCode: 403 })
  } finally {
    hooks.deregister()
    delete globalThis.__apf
  }
})
test('APF scheduler sample is a bounded inspect operation; purpose stays separate from U', () => {
  const routes = readFileSync(new URL('../../data-runtime/internal/server/enterprise_apf.go', import.meta.url), 'utf8')
  assert.match(routes, /authenticateEnterpriseSystem\(r, spec.domain, ""\)/)
  assert.match(routes, /notificationDetailViewer\(r, identity\)/)
  const owning = readFileSync(new URL('../../data-runtime/internal/enterpriseapf/service.go', import.meta.url), 'utf8')
  assert.match(owning, /LIMIT 100/)
  assert.match(owning, /BeginSchedulerTransaction/)
})
// 14c completes the exact Host mappings frozen by 14b. No unrelated gap is allowed.
test('APF Runtime and Host register all 13 APF-14c operations with no user mapping gaps', () => {
  const runtime = readFileSync(new URL('../../data-runtime/internal/server/enterprise_apf.go', import.meta.url), 'utf8')
  const foundation = readFileSync(new URL('../../foundation/server/utils/enterpriseRuntimeClient.ts', import.meta.url), 'utf8')
  const entries = [...runtime.matchAll(/"(\/v1\/[^"\n]+)":\s*\{"([^"]+)", "([^"]+)", "([^"]+)"\}/g)]
  const due = entries.filter(e => /:(scan-due|published|closure-ack)$/.test(e[1]))
  assert.equal(due.length, 18, 'six fixed due families times three S operations')
  assert.ok(due.every(e => e[4] === 'system'))
  const dead = entries.filter(e => /\/(pending-dead-letter-actionables|dead-letter-actionable-published|pending-dead-letter-closures|dead-letter-closure-acknowledged)$/.test(e[1]))
  assert.equal(dead.length, 12, 'three domains times four fixed S commands')
  assert.ok(dead.every(e => e[4] === 'system'))
  assert.equal(entries.length - due.length - dead.length, 284, 'Runtime closed set includes B5-A and 14 B5-B operations')
  assert.equal(new Set(entries.map(entry => entry[1])).size, entries.length, 'no duplicate Runtime path')
  const cost14c = [
    ['project-accounting:page', 'project-accounting-page'],
    ['project-accounting:view', 'project-accounting-view'],
    ['project-labor:preview', 'project-labor-preview'],
    ['project-labor:recalculate', 'project-labor-recalculate'],
    ['project-labor:history-page', 'project-labor-history-page'],
    ['project-labor:history-view', 'project-labor-history-view'],
    ['project-cost-allocations:page', 'project-cost-allocations-page'],
    ['project-cost-allocations:view', 'project-cost-allocations-view'],
    ['employee-costs:page', 'employee-costs-page'],
    ['employee-costs:view', 'employee-costs-view'],
    ['project-cost-period:view', 'project-cost-period-view'],
    ['project-cost-period:confirm-zero', 'project-cost-period-confirm-zero'],
    ['project-cost-period:close', 'project-cost-period-close']
  ].map(([path, operation]) => [`/v1/enterprise/finance/${path}`, 'finance', operation, 'user'])
  const costPaths = new Set(cost14c.map(entry => entry[0]))
  assert.deepEqual(entries.filter(entry => costPaths.has(entry[1])).map(entry => entry.slice(1)).sort(), cost14c.sort())
  const hostPaths = new Set([...foundation.matchAll(/path: '(\/v1\/[^']+)'/g)].map(entry => entry[1]))
  for (const action of ['customer-service-finance-summary', 'service-cost-summary-view']) {
    const path = `/v1/enterprise/altoc/${action}`
    assert.equal(entries.find(entry => entry[1] === path)?.[4], 'user')
    assert.equal(hostPaths.has(path), true)
  }
  const feedbackUserPaths = ['view', 'submit', 'resume'].map(action => `/v1/enterprise/altoc/product-feedback-${action}`)
  const feedbackSystemPaths = ['status', 'progress'].map(action => `/v1/enterprise/altoc/product-feedback-${action}`)
  for (const path of feedbackUserPaths) {
    const route = entries.find(entry => entry[1] === path)
    assert.equal(route?.[4], 'user')
    assert.equal(hostPaths.has(path), true)
  }
  for (const path of feedbackSystemPaths) {
    const route = entries.find(entry => entry[1] === path)
    assert.equal(route?.[4], 'system')
    assert.equal(hostPaths.has(path), false, 'system projection is not a Host U operation')
  }
  const runtimeUsers = entries.filter(entry => entry[4] === 'user')
  assert.deepEqual(runtimeUsers.filter(entry => !hostPaths.has(entry[1])).map(entry => entry[1]).sort(), [], 'every Runtime user operation is registered in Host')
  assert.equal(entries.filter(entry => !costPaths.has(entry[1]) && !due.includes(entry) && !dead.includes(entry)).length, 271, 'non-cost Runtime closed set includes B5-A and 14 B5-B operations')
  for (const path of costPaths) assert.equal(hostPaths.has(path), true, '14c now registers the exact cost path')
})
test('APF forwarded authorization uses only literal existing manifest resource/actions', () => {
  const source = readFileSync(new URL('../server/utils/enterpriseAPF.ts', import.meta.url), 'utf8')
  for (const [domain, resource, action] of [['altoc', 'customer', 'edit'], ['finance', 'bank_accounts', 'admin'], ['people', 'positions', '']]) {
    assert.ok(source.includes(`${domain}: { resource: '${resource}', write: '${action}'`))
    const manifest = JSON.parse(readFileSync(new URL(`../../${domain}/app.manifest.json`, import.meta.url), 'utf8'))
    const found = manifest.resources.find(r => r.code === resource)
    assert.ok(found.actions.includes('view'))
    if (action) assert.ok(found.actions.includes(action))
  }
})
test('B5B closed Runtime operations have exact Host signing and manifest personnel mappings', () => {
  const runtime = readFileSync(new URL('../../data-runtime/internal/enterpriseapf/finance_receivables.go', import.meta.url), 'utf8')
  const block = runtime.slice(runtime.indexOf('var financeReceivableOps'), runtime.indexOf('func ValidateFinanceReceivableInput'))
  const ops = [...block.matchAll(/"([^"]+)":\s*\{"[^"]+", "([^"]+)", "([^"]+)"/g)]
  assert.equal(ops.length, 14)
  const bff = readFileSync(new URL('../server/utils/enterpriseFinanceLedger.ts', import.meta.url), 'utf8')
  const transport = readFileSync(new URL('../../foundation/server/utils/enterpriseRuntimeClient.ts', import.meta.url), 'utf8')
  const manifest = JSON.parse(readFileSync(new URL('../../finance/app.manifest.json', import.meta.url), 'utf8'))
  for (const [, op, resource, action] of ops) {
    assert.ok(transport.includes(`finance.b5b-${op}`), op)
    assert.ok(bff.includes(`'${op}': { resource: '${resource}', action: '${action}'`), op)
    assert.ok(manifest.resources.some(row => row.code === resource && row.actions.includes(action)), `${resource}:${action}`)
    assert.ok(manifest.recommendedRoles.some(role => role.suggestedPermissions.includes(`finance:${resource}:${action}`) || (action === 'view' && ['edit', 'admin'].some(implied => role.suggestedPermissions.includes(`finance:${resource}:${implied}`)))), `${resource}:${action}`)
  }
})
