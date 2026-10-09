import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { readFileSync } from 'node:fs'

const marker = 'TEST-ACCOUNT-0000000000001234'

test('account number reveal: explicit action, Host-derived client address, nothing cached or logged', async () => {
  const state = { calls: [], headers: {}, scoped: [], body: { reason: '月末对账核对' }, query: {}, code: 'BA-W000002', allowed: true, request: { 'x-forwarded-for': '198.51.100.9', 'x-real-ip': '203.0.113.7', 'user-agent': 'Fixture/1.0' }, remoteAddress: '127.0.0.1', logged: [] }
  globalThis.__reveal = state
  const original = { log: console.log, warn: console.warn, error: console.error, info: console.info }
  for (const level of Object.keys(original)) console[level] = (...args) => state.logged.push(JSON.stringify(args))
  const hooks = registerHooks({ resolve(specifier, context, next) {
    let source
    if (specifier === 'h3') source = `const s=()=>globalThis.__reveal;export const createError=x=>Object.assign(Error('fixed'),x);export const getRouterParam=()=>s().code;export const getQuery=()=>s().query;export const getHeader=(_e,n)=>s().request[n];export const readBody=async()=>s().body;export const setHeader=(_e,k,v)=>{s().headers[k]=v}`
    if (specifier.endsWith('/enterpriseRuntimeClient')) source = `const s=()=>globalThis.__reveal;export const requireEnterpriseUser=async()=>({uid:'finance-admin',tenant:'C000001',deployment:'Host'});export const prepareEnterpriseRuntime=async()=>true;export const enterpriseRuntimePermitExpiresAt=()=>Date.now()+14000;export const callEnterpriseRuntime=async(...a)=>{s().calls.push(a);if(s().fail)throw Object.assign(Error('fixed'),{statusCode:s().fail});return {code:0,data:{data:{code:s().code,accountNo:'${marker}',revealedAt:'2026-10-04T00:00:00Z'}}}}`
    if (specifier.endsWith('/platformBundleAuthorization')) source = `export const loadScopedAuthorizationFromConsoleRuntime=async(_e,uid,app,required)=>{globalThis.__reveal.scoped.push(required);return {uid,appCode:app,bundleVersion:'1',bundleHash:'hash',policyRevision:1,grants:[],actionPolicy:{},authorizationExpiresAt:Date.now()+60000}}`
    if (specifier.endsWith('/scopeEvaluator')) source = `export const evaluateFoundationScopedAuthorization=x=>{globalThis.__reveal.evaluated=x.required;return {allowed:globalThis.__reveal.allowed}}`
    if (source) return { url: 'data:text/javascript,' + encodeURIComponent(source), shortCircuit: true }
    if (specifier.endsWith('/trustedClientAddress')) return next(new URL('../../foundation/server/utils/trustedClientAddress.ts', import.meta.url).href, context)
    return next(specifier, context)
  } })
  const socket = Object.defineProperty({}, 'remoteAddress', { get: () => state.remoteAddress })
  const event = { node: { req: { socket } } }
  try {
    const { enterpriseFinanceRevealAccountNo, normalizeAccountNoReveal } = await import('../server/utils/enterpriseFinance.ts')
    const out = await enterpriseFinanceRevealAccountNo(event)
    assert.deepEqual(out, { data: { code: 'BA-W000002', accountNo: marker, revealedAt: '2026-10-04T00:00:00Z' } })
    assert.equal(state.headers['Cache-Control'], 'no-store')
    // Authorization asks for the explicit action, both at Console and in the permit.
    assert.deepEqual(state.scoped[0], { resourceCode: 'bank_accounts', action: 'reveal-account-no' })
    assert.deepEqual(state.evaluated, { appCode: 'finance', resourceCode: 'bank_accounts', action: 'reveal-account-no' })
    const [, op, body, options] = state.calls[0]
    assert.equal(op, 'finance.wp3-accounts-reveal-account-no')
    assert.deepEqual([body.authorization.resource, body.authorization.action, body.authorization.operation, body.authorization.objectId], ['bank_accounts', 'reveal-account-no', 'accounts-reveal-account-no', 'BA-W000002'])
    // The Gateway-overwritten header is used behind a loopback proxy; X-Forwarded-For never.
    assert.deepEqual(body.finance.payload, { reason: '月末对账核对', clientIp: '203.0.113.7', userAgent: 'Fixture/1.0' })
    // Not an idempotent command: every view is a new audited access.
    assert.equal(options, undefined)

    // Reached directly: forwarding headers are browser-controlled and ignored.
    state.remoteAddress = '203.0.113.50'
    await enterpriseFinanceRevealAccountNo(event)
    assert.equal(state.calls[1][2].finance.payload.clientIp, '203.0.113.50')
    state.remoteAddress = '127.0.0.1'

    // The browser cannot supply the client address, a secret code or anything but a reason.
    for (const body of [{ reason: '月末对账核对', clientIp: '1.2.3.4' }, { reason: '月末对账核对', secretCode: 'console.oidc' }, { reason: 'abc' }, { reason: ' 月末对账核对 ' }, { reason: 'x'.repeat(201) }, {}, [], 'reason']) {
      assert.throws(() => normalizeAccountNoReveal('BA-W000002', {}, body), { statusCode: 400 })
    }
    assert.throws(() => normalizeAccountNoReveal('BA-W000002', { versionNo: '1' }, { reason: '月末对账核对' }), { statusCode: 400 })
    assert.throws(() => normalizeAccountNoReveal('../x', {}, { reason: '月末对账核对' }), { statusCode: 400 })

    // Without the action nothing reaches Runtime.
    const before = state.calls.length
    state.allowed = false
    await assert.rejects(enterpriseFinanceRevealAccountNo(event), { statusCode: 403 })
    assert.equal(state.calls.length, before)
    state.allowed = true
    // Runtime failures keep their status: 404 / 429 / 503 are not turned into 403.
    for (const status of [404, 429, 503]) {
      state.fail = status
      await assert.rejects(enterpriseFinanceRevealAccountNo(event), { statusCode: status })
    }
    state.fail = 0
    // Nothing on this path writes the account number to a log.
    assert.equal(state.logged.some(line => line.includes(marker)), false)
    assert.deepEqual(state.logged, [])
  } finally {
    hooks.deregister()
    Object.assign(console, original)
    delete globalThis.__reveal
  }
})

test('reveal path has no logging of bodies in Host, Foundation transport or Runtime access log', () => {
  const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')
  const helper = read('../server/utils/enterpriseFinance.ts')
  const handler = helper.slice(helper.indexOf('export async function enterpriseFinanceRevealAccountNo'))
  assert.equal(/console\.|logger\.|useStorage|setCookie|localStorage/.test(handler), false)
  assert.ok(handler.includes('setHeader(event, \'Cache-Control\', \'no-store\')'))
  // Foundation's Runtime transport logs only closed metadata on failure.
  const transport = read('../../foundation/server/utils/tenantRuntimeClient.ts')
  const logs = [...transport.matchAll(/console\.(?:log|warn|error|info)\(([\s\S]*?)\n\s*\}\)\n|console\.(?:log|warn|error|info)\((.*)\)\n/g)].map(m => m[1] || m[2])
  assert.ok(logs.length >= 3)
  for (const call of logs) assert.equal(/\b(body|responseText|_data|response\._data|payload|result)\b/.test(call), false, call)
  assert.ok(transport.includes('upstream: safeUpstreamResponseMetadata(error)'))
  // Runtime's access record is a closed set of metadata fields with no body.
  const audit = read('../../data-runtime/internal/audit/audit.go')
  const record = audit.slice(audit.indexOf('type Record struct'), audit.indexOf('}', audit.indexOf('type Record struct')))
  assert.deepEqual([...record.matchAll(/`json:"([^",]+)/g)].map(m => m[1]), ['ts', 'requestId', 'tenant', 'deployment', 'appCode', 'subject', 'operation', 'resource', 'durationMs', 'result', 'status', 'errorCode'])
  // The Runtime reveal never puts vault errors or plaintext into its error messages.
  const reveal = read('../../data-runtime/internal/enterpriseapf/finance_account_reveal.go')
  assert.equal(/log\.|fmt\.Print|Sprintf\(.*value/.test(reveal), false)
  assert.ok(reveal.includes('"finance_account_vault_unavailable", "Account number vault is unavailable"'))
})

test('reveal-account-no is an explicit Finance action held only by the finance admin role', async () => {
  const { authorizationActionsAllow } = await import('../../foundation/shared/utils/authorizationActions.ts')
  const manifest = JSON.parse(readFileSync(new URL('../../finance/app.manifest.json', import.meta.url), 'utf8'))
  const accounts = manifest.resources.find(resource => resource.code === 'bank_accounts')
  assert.ok(accounts.actions.includes('reveal-account-no'))
  assert.equal(manifest.actionImplications, undefined)
  for (const granted of [['admin'], ['edit'], ['view'], ['view', 'edit', 'admin']]) assert.equal(authorizationActionsAllow(granted, 'reveal-account-no'), false, granted.join(','))
  assert.equal(authorizationActionsAllow(['reveal-account-no'], 'reveal-account-no'), true)
  // Holding the reveal action does not grant account administration either.
  assert.equal(authorizationActionsAllow(['reveal-account-no'], 'admin'), false)
  const holders = manifest.recommendedRoles.filter(role => role.suggestedPermissions.includes('finance:bank_accounts:reveal-account-no')).map(role => role.code)
  assert.deepEqual(holders, ['finance:admin'])
})

test('bank_accounts:edit registers balances and nothing else', async () => {
  const { authorizationActionsAllow } = await import('../../foundation/shared/utils/authorizationActions.ts')
  const { financeOperations, normalizeBalanceEntryRequest } = await import('../server/utils/enterpriseFinance.ts')
  // Holding edit satisfies view, but neither account administration nor the reveal.
  assert.equal(authorizationActionsAllow(['edit'], 'view'), true)
  for (const action of ['admin', 'reveal-account-no']) assert.equal(authorizationActionsAllow(['edit'], action), false, action)
  // Every account-data write of the generic Finance helper still requires admin.
  for (const operation of ['accounts-create', 'accounts-update']) assert.deepEqual(financeOperations[operation], { resource: 'bank_accounts', action: 'admin' })
  assert.equal(Object.values(financeOperations).some(required => required.resource === 'bank_accounts' && required.action === 'edit'), false)
  const helper = readFileSync(new URL('../server/utils/enterpriseFinance.ts', import.meta.url), 'utf8')
  assert.equal([...helper.matchAll(/resourceCode: 'bank_accounts', action: 'edit'/g)].length, 2)
  const manifest = JSON.parse(readFileSync(new URL('../../finance/app.manifest.json', import.meta.url), 'utf8'))
  const cashier = manifest.recommendedRoles.find(role => role.code === 'finance:cashier').suggestedPermissions
  assert.ok(cashier.includes('finance:bank_accounts:edit'))
  for (const forbidden of ['finance:bank_accounts:admin', 'finance:bank_accounts:reveal-account-no']) assert.equal(cashier.includes(forbidden), false, forbidden)
  // A registration carries a date, an amount and a note; no account field rides along.
  assert.deepEqual(normalizeBalanceEntryRequest(true, 'BA-1', {}, { balanceDate: '2026-09-30', balanceAmount: '-5000.00' }).payload, { balanceDate: '2026-09-30', balanceAmount: '-5000.00', note: null })
  assert.equal(normalizeBalanceEntryRequest(false, 'BA-1', { date: '2026-09-30' }, {}).startDate, '2026-09-30')
  for (const body of [{ balanceDate: '2026-09-30', balanceAmount: 100 }, { balanceDate: '2026-09-30', balanceAmount: '1.001' }, { balanceDate: '2026/09/30', balanceAmount: '1.00' }, { balanceDate: '2026-09-30', balanceAmount: '1.00', accountName: 'x' }, { balanceDate: '2026-09-30', balanceAmount: '1.00', entrySource: 'import' }, { balanceDate: '2026-09-30', balanceAmount: '1.00', recordedAt: '2020-01-01' }]) {
    assert.throws(() => normalizeBalanceEntryRequest(true, 'BA-1', {}, body), { statusCode: 400 }, JSON.stringify(body))
  }
  assert.throws(() => normalizeBalanceEntryRequest(false, 'BA-1', { date: '2026-09-30', accountCode: 'BA-2' }, {}), { statusCode: 400 })
})
