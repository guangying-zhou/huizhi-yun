import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

test('Finance typed BFF uses the UI contract, preserves admin and dependency failures', async () => {
  const root = resolve(import.meta.dirname, '../..')
  const calls = []
  let allowed = true, sourceFailed = false, bankView = false
  globalThis.__apf = { calls, body: {}, query: {}, key: 'marked-key', allowed: () => allowed, failed: () => sourceFailed, bankView: () => bankView }
  const hooks = registerHooks({ resolve(specifier, context, next) {
    let source
    if (specifier === 'h3') source = `export const createError=x=>Object.assign(new Error('fixed'),x);export const getRouterParam=()=>undefined;export const getQuery=()=>globalThis.__apf.query;export const getHeader=()=>globalThis.__apf.key;export const readBody=async()=>globalThis.__apf.body;export const setHeader=()=>{}`
    if (specifier.endsWith('/enterpriseRuntimeClient')) source = `export const requireEnterpriseUser=async()=>({uid:'Person',tenant:'C000001',deployment:'Host'});export const prepareEnterpriseRuntime=async()=>true;export const enterpriseRuntimePermitExpiresAt=()=>Date.now()+14000;export const callEnterpriseRuntime=async(...args)=>{globalThis.__apf.calls.push(args);return {code:0,data:globalThis.__apf.result||{data:[],total:1,page:1,pageSize:20}}}`
    if (specifier.endsWith('/enterpriseRuntimeChannels')) source = `export const callEnterpriseNotificationRuntime=async()=>({code:0,data:{allowed:true}})`
    if (specifier.endsWith('/tenantRuntimeClient')) source = `export const prepareTenantRuntime=async()=>true`
    if (specifier.endsWith('/platformBundleAuthorization')) source = `export const loadScopedAuthorizationFromConsoleRuntime=async(_e,uid,appCode,required)=>{if(globalThis.__apf.failed())throw Object.assign(new Error('dependency'),{statusCode:503});globalThis.__apf.required=required;return {uid,appCode,bundleVersion:'1',bundleHash:'hash',policyRevision:1,authorizationExpiresAt:Date.now()+14000,grants:[],roles:[],required}}`
    if (specifier.endsWith('/scopeEvaluator')) source = `export const evaluateFoundationScopedAuthorization=(x)=>({allowed:globalThis.__apf.allowed()&&(x.required.resourceCode!=='bank_accounts'||x.required.action!=='view'||globalThis.__apf.bankView())})`
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
    const { enterpriseFinance, normalizeFinanceRequest } = await import('../server/utils/enterpriseFinance.ts')
    globalThis.__apf.body = { accountName: 'marked', bankName: null, accountNoMasked: '****1234', accountType: 'bank', currencyCode: 'CNY', ownerDeptCode: null }
    const result = await enterpriseFinance({}, 'accounts-create')
    assert.deepEqual(result, { data: [], total: 1, page: 1, pageSize: 20 })
    assert.deepEqual(globalThis.__apf.required, { resourceCode: 'bank_accounts', action: 'admin' })
    await enterpriseFinance({}, 'accounts-create')
    assert.equal(calls[0][3].idempotencyKey, calls[1][3].idempotencyKey)
    assert.equal(calls[0][1], 'finance.wp3-accounts-create')
    assert.equal(calls[0][2].authorization.actorUid, 'Person')
    assert.equal(calls[0][2].finance.payload.accountName, 'marked')
    assert.equal(calls[0][2].finance.code, '')
    allowed = false
    await assert.rejects(enterpriseFinance({}, 'accounts-create'), { statusCode: 403 })
    assert.equal(calls.length, 2)
    allowed = true
    sourceFailed = true
    await assert.rejects(enterpriseFinance({}, 'parameters-list'), { statusCode: 503 })
    sourceFailed = false
    await enterpriseFinance({}, 'parameters-list')
    assert.deepEqual(globalThis.__apf.required, { resourceCode: 'settings', action: 'admin' })
    globalThis.__apf.result = { data: [{ id: 1, code: 'LE1', account_count: 99 }], total: 1, page: 1, pageSize: 20 }
    const withoutBankView = await enterpriseFinance({}, 'legal-entities-list')
    assert.ok(!Object.hasOwn(withoutBankView.data[0], 'account_count'))
    assert.equal(calls.at(-1)[2].finance.accountCountAllowed, undefined)
    bankView = true
    const withBankView = await enterpriseFinance({}, 'legal-entities-list')
    assert.equal(withBankView.data[0].account_count, 99)
    assert.equal(calls.at(-1)[2].finance.accountCountAllowed, true)
    assert.throws(() => normalizeFinanceRequest('legal-entities-list', { accountCountAllowed: 'true' }, undefined, {}), { statusCode: 400 })
    const filtered = normalizeFinanceRequest('accounts-list', { legalEntityCode: 'LE1', accountType: 'bank', complete: 'true' }, undefined, {})
    assert.equal(filtered.legalEntityCode, 'LE1')
    assert.equal(filtered.accountType, 'bank')
    assert.equal(filtered.complete, true)
    assert.equal(normalizeFinanceRequest('balances-list', { legalEntityCode: 'LE1' }, undefined, {}).legalEntityCode, 'LE1')
    const oldRead = normalizeFinanceRequest('accounts-list', {}, undefined, {})
    for (const key of ['legalEntityCode', 'accountType', 'complete']) assert.ok(!Object.hasOwn(oldRead, key))
    for (const query of [{ legalEntityCode: 'bad/code' }, { accountType: 'unknown' }, { complete: 'true', page: '2' }, { complete: 'yes' }]) assert.throws(() => normalizeFinanceRequest('accounts-list', query, undefined, {}), { statusCode: 400 })
    assert.throws(() => normalizeFinanceRequest('parameters-list', { legalEntityCode: 'LE1' }, undefined, {}), { statusCode: 400 })
    const patch = normalizeFinanceRequest('accounts-update', {}, 'BA-CODE', { accountName: 'edit', expectedVersion: 2 })
    assert.equal(patch.payload.expectedVersion, 2)
    for (const body of [{ actor: 'forged' }, { accountNo: '123' }, { accountName: 'x', expectedVersion: 1.5 }, { accountName: 'x', rowVersion: 1 }]) assert.throws(() => normalizeFinanceRequest('accounts-update', {}, 'BA-CODE', body), { statusCode: 400 })
    assert.throws(() => normalizeFinanceRequest('parameters-create', {}, undefined, { baseSalary: 1.2 }), { statusCode: 400 })
    assert.throws(() => normalizeFinanceRequest('accounts-list', { page: ['1'] }, undefined, {}), { statusCode: 400 })
    // W3: legal entity directory and the account fields added by W1 share the closed whitelist.
    assert.deepEqual(normalizeFinanceRequest('legal-entities-create', {}, undefined, { name: '主体', shortName: '简称', sortNo: 2 }).payload, { name: '主体', shortName: '简称', sortNo: 2 })
    assert.equal(normalizeFinanceRequest('legal-entities-list', { page: '2', search: '主体' }, undefined, {}).page, 2)
    assert.deepEqual(normalizeFinanceRequest('accounts-update', {}, 'BA-CODE', { shortName: 'main', legalEntityCode: 'ENT-W000004', accountSubtype: null, sortNo: 1, expectedVersion: 2 }).payload, { shortName: 'main', legalEntityCode: 'ENT-W000004', accountSubtype: null, sortNo: 1, expectedVersion: 2 })
    for (const [operation, body] of [['legal-entities-create', { name: 'x', accountNoSecretRef: 'hzybase://vault/x' }], ['legal-entities-update', { name: 'x', code: 'ENT-2', expectedVersion: 1 }], ['legal-entities-update', { name: 'x' }], ['accounts-update', { invoiceTitle: 'x', expectedVersion: 1 }], ['parameters-update', { shortName: 'x', expectedVersion: 1 }]]) assert.throws(() => normalizeFinanceRequest(operation, {}, 'CODE-1', body), { statusCode: 400 })
  } finally {
    hooks.deregister()
    delete globalThis.__apf
  }
})
test('Finance REST registry preserves exact paths/methods, version history and parameter admin gate', () => {
  const routes = [
    ['bank-accounts/index.get', 'accounts-list'], ['bank-accounts/index.post', 'accounts-create'], ['bank-accounts/[code].get', 'accounts-view'], ['bank-accounts/[code].patch', 'accounts-update'], ['bank-accounts/balances.get', 'balances-list'],
    ['settings/people-cost-parameters/index.get', 'parameters-list'], ['settings/people-cost-parameters/index.post', 'parameters-create'], ['settings/people-cost-parameters/[code].get', 'parameters-view'], ['settings/people-cost-parameters/[code].patch', 'parameters-update'], ['settings/people-cost-parameters/[code]/history.get', 'parameters-history']]
  for (const [path, op] of routes) assert.ok(readFileSync(new URL(`../server/routes/finance/api/v1/${path}.ts`, import.meta.url), 'utf8').includes(`enterpriseFinance(event, '${op}')`))
  const source = readFileSync(new URL('../server/utils/enterpriseFinance.ts', import.meta.url), 'utf8')
  assert.match(source, /private, no-store/)
  assert.match(source, /settings.*admin/)
})

test('Finance personnel pairs are manifest facts, not new permissions', () => {
  const manifest = JSON.parse(readFileSync(new URL('../../finance/app.manifest.json', import.meta.url), 'utf8'))
  for (const [r, a] of [['bank_accounts', 'view'], ['bank_accounts', 'admin'], ['settings', 'admin']]) assert.ok(manifest.resources.find(x => x.code === r).actions.includes(a))
  const source = readFileSync(new URL('../server/utils/enterpriseFinance.ts', import.meta.url), 'utf8')
  assert.equal((source.match(/'parameters-[^']+': \{ resource: 'settings', action: 'admin' \}/g) || []).length, 5)
})
