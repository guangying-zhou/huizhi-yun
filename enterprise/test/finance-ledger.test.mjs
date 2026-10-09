import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

test('APF11a BFF binds Finance actions, scope, version and original key without broad proxy', async () => {
  const root = resolve(import.meta.dirname, '../..')
  let allowed = true
  const calls = []
  const hooks = registerHooks({ resolve(specifier, context, next) {
    let code
    if (specifier === 'h3') code = `export const createError=x=>Object.assign(Error('fixed'),x);export const getHeader=()=> 'original';export const setHeader=()=>{};export const getQuery=()=>({});export const getRouterParam=()=> 'IR1';export const readBody=async()=>({expectedVersion:3})`
    if (specifier.endsWith('/enterpriseRuntimeClient')) code = `export const requireEnterpriseUser=async()=>({uid:'issuer',tenant:'C000001',deployment:'Host'});export const prepareEnterpriseRuntime=async()=>true;export const enterpriseRuntimePermitExpiresAt=()=>Date.now()+14000;export const callEnterpriseRuntime=async(...a)=>{globalThis.__ledgerCalls.push(a);return {code:0,data:{data:{code:'IR1'}}}}`
    if (specifier.endsWith('/platformBundleAuthorization')) code = `export const loadScopedAuthorizationFromConsoleRuntime=async(_e,uid,appCode,required)=>({uid,appCode,bundleVersion:'1',bundleHash:'hash',policyRevision:1,authorizationExpiresAt:Date.now()+14000,grants:globalThis.__ledgerAllowed?[{permissions:[{appCode,resourceCode:required.resourceCode,action:globalThis.__ledgerAdmin?'admin':required.action}],scopes:globalThis.__ledgerEmpty?[]:globalThis.__ledgerGlobal?[{dimension:'tenant',predicate:'global'}]:[{dimension:'subject',predicate:'self'}]}]:[]})`
    if (specifier.endsWith('/directoryApi')) code = `export const fetchDirectoryActiveStatuses=async()=>[]`
    if (code) return { url: 'data:text/javascript,' + encodeURIComponent(code), shortCircuit: true }
    let candidate
    if (specifier.startsWith('@hzy/foundation/')) candidate = resolve(root, 'foundation', specifier.slice('@hzy/foundation/'.length))
    else if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) candidate = resolve(dirname(fileURLToPath(context.parentURL)), specifier)
    if (candidate && !existsSync(candidate) && existsSync(`${candidate}.ts`)) return { url: pathToFileURL(`${candidate}.ts`).href, shortCircuit: true }
    return next(specifier, context)
  } })
  globalThis.__ledgerCalls = calls
  globalThis.__ledgerAllowed = allowed
  try {
    const { normalizeFinanceLedgerRequest, callFinanceLedger, financeLedgerOperations } = await import('../server/utils/enterpriseFinanceLedger.ts')
    assert.equal(Object.keys(financeLedgerOperations).length, 84)
    assert.equal(financeLedgerOperations['invoice-requests-issue'].action, 'issue')
    assert.equal(financeLedgerOperations['receivable-adjustments-confirm'].action, 'confirm')
    assert.equal(financeLedgerOperations['receivable-adjustments-reverse'].action, 'reverse')
    assert.equal(financeLedgerOperations['historical-finance-activate'].action, 'activate')
    const candidates = normalizeFinanceLedgerRequest('allocation-candidates', 'R1', { page: 2, pageSize: 20 }, undefined)
    assert.equal(candidates.page, 2)
    assert.equal(candidates.pageSize, 20)
    const allocation = { receiptVersion: 1, items: [{ contractCode: 'CT1', billingScheduleCode: 'BS1', scheduleVersion: 2, amount: '60.00' }] }
    assert.deepEqual(normalizeFinanceLedgerRequest('reconciliation-allocate-batch', 'R1', {}, allocation).payload, allocation)
    assert.throws(() => normalizeFinanceLedgerRequest('reconciliation-allocate-batch', 'R1', {}, { receiptVersion: 1, items: [{ actorUid: 'forged', amount: '60.00' }] }))
    assert.equal(financeLedgerOperations['claims-confirm'].action, 'confirm')
    assert.equal(financeLedgerOperations['claims-submit'].action, 'edit')
    const claim = normalizeFinanceLedgerRequest('claims-create', undefined, {}, { title: 'Marked', currencyCode: 'CNY', items: [{ description: 'Work', amount: '1.01' }] })
    assert.equal(claim.payload.items[0].amount, '1.01')
    assert.throws(() => normalizeFinanceLedgerRequest('claims-create', undefined, {}, { items: [{ actor: 'spoof' }] }), { statusCode: 400 })
    assert.equal(financeLedgerOperations['reconciliation-create'].action, 'confirm')
    const request = normalizeFinanceLedgerRequest('invoice-requests-issue', 'IR1', {}, { expectedVersion: 3 })
    await callFinanceLedger({}, 'invoice-requests-issue', request)
    assert.equal(calls[0][1], 'finance.11a-invoice-requests-issue')
    assert.equal(calls[0][2].authorization.scope.access, 'self')
    assert.equal(calls[0][3].idempotencyKey, 'original')
    assert.equal(calls[0][2].finance.payload.expectedVersion, 3)
    allowed = false
    globalThis.__ledgerAllowed = allowed
    await assert.rejects(callFinanceLedger({}, 'invoice-requests-issue', request), { statusCode: 403 })
    assert.equal(calls.length, 1)
    assert.throws(() => normalizeFinanceLedgerRequest('invoice-requests-issue', 'IR1', {}, { confirmedBy: 'spoof' }), { statusCode: 400 })
    assert.throws(() => normalizeFinanceLedgerRequest('receipts-page', undefined, { pageSize: 101 }, {}), { statusCode: 400 })
    globalThis.__ledgerAllowed = true
    const setting = normalizeFinanceLedgerRequest('subjects-update', '6001', {}, { name: 'Marked', status: 'inactive', expectedVersion: 3 })
    await assert.rejects(callFinanceLedger({}, 'subjects-update', setting), { statusCode: 403 })
    globalThis.__ledgerGlobal = true
    await callFinanceLedger({}, 'subjects-update', setting)
    assert.equal(calls.at(-1)[1], 'finance.13b-subjects-update')
    assert.equal(calls.at(-1)[2].authorization.resource, 'settings')
    assert.equal(calls.at(-1)[2].authorization.action, 'admin')
    assert.equal(calls.at(-1)[3].idempotencyKey, 'original')
    const exact = normalizeFinanceLedgerRequest('subjects-page', undefined, { code: '6001', pageSize: 1 }, {})
    assert.equal(exact.code, '6001')
    assert.throws(() => normalizeFinanceLedgerRequest('payment-requests-update', 'PAY1', {}, { status: 'paid', expectedVersion: 3 }), { statusCode: 400 })
    const payment = normalizeFinanceLedgerRequest('payment-requests-confirm', 'PAY1', {}, { expectedVersion: 3 })
    await callFinanceLedger({}, 'payment-requests-confirm', payment)
    assert.equal(calls.at(-1)[1], 'finance.13b-payment-requests-confirm')
    assert.equal(calls.at(-1)[2].authorization.action, 'confirm')
    const fileInput = normalizeFinanceLedgerRequest('invoice-files-attach', undefined, {}, { entityType: 'finance_invoice_request', attachmentPurpose: 'issuance' })
    await callFinanceLedger({}, 'invoice-files-attach', fileInput)
    assert.equal(calls.at(-1)[2].authorization.action, 'issue')
    globalThis.__ledgerAdmin = true
    await assert.rejects(callFinanceLedger({}, 'invoice-files-attach', fileInput), { statusCode: 403 })
    globalThis.__ledgerAdmin = false
    // hzy0 revision 39 has Finance admin/view permissions but no scope rows.
    // The flattened snapshot cannot authorize an unbounded Finance list.
    globalThis.__ledgerEmpty = true
    globalThis.__ledgerAdmin = true
    const before = calls.length
    for (const operation of ['historical-finance-page', 'invoice-requests-page', 'receipts-page', 'reconciliation-page', 'expenses-page', 'claims-page', 'project-requests-page', 'payment-requests-page']) {
      const input = normalizeFinanceLedgerRequest(operation, undefined, {}, {})
      await assert.rejects(callFinanceLedger({}, operation, input), { statusCode: 403 })
      assert.equal(calls.length, before, 'scope denial precedes Runtime')
    }
    globalThis.__ledgerEmpty = false
    for (const operation of ['historical-finance-page', 'invoice-requests-page', 'receipts-page', 'reconciliation-page', 'expenses-page', 'claims-page', 'project-requests-page', 'payment-requests-page']) {
      await callFinanceLedger({}, operation, normalizeFinanceLedgerRequest(operation, undefined, {}, {}))
      assert.equal(calls.at(-1)[2].authorization.scope.access, 'all', 'explicit global scope and same-resource admin permit view')
    }
  } finally {
    hooks.deregister()
    delete globalThis.__ledgerCalls
    delete globalThis.__ledgerGlobal
    delete globalThis.__ledgerEmpty
    delete globalThis.__ledgerAdmin
    delete globalThis.__ledgerAllowed
  }
})
