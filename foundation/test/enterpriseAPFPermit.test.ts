import test from 'node:test'
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { enterpriseAPFPermitCanonical, apfUserPaths, isAPFPermitPath } from '../server/utils/enterpriseAPFPermit'

test('APF permit canonicalization binds every intent and authorization fact', () => {
  const body = { id: '', code: 'MARKED', name: '中文\u2028', rowVersion: 0, page: 0, pageSize: 0, search: '', authorization: { actorUid: 'Person', tenant: 'C000001', deployment: 'Host', resource: 'bank_accounts', action: 'admin', operation: 'save', objectId: '', allowed: true, expiresAt: 123, bundleVersion: '1', bundleHash: 'hash', policyRevision: 38, scope: { access: 'all', departmentCodes: [] } } }
  const canonical = enterpriseAPFPermitCanonical('POST', '/v1/enterprise/finance/bank-accounts:save', body)
  assert.match(canonical, /\\u2028/u)
  for (const key of ['code', 'name', 'rowVersion']) assert.notEqual(enterpriseAPFPermitCanonical('POST', 'path', { ...body, [key]: 'changed' }), enterpriseAPFPermitCanonical('POST', 'path', body))
  for (const key of Object.keys(body.authorization)) assert.notEqual(enterpriseAPFPermitCanonical('POST', 'path', { ...body, authorization: { ...body.authorization, [key]: key === 'scope' ? { access: 'none' } : 'changed' } }), enterpriseAPFPermitCanonical('POST', 'path', body))
})
test('APF user and purpose signing whitelist is closed; People exposes only fixed master-data writes', () => {
  assert.equal(apfUserPaths.length, 279)
  for (const path of apfUserPaths) assert.equal(isAPFPermitPath(path), true)
  for (const domain of ['altoc', 'finance', 'people']) assert.equal(isAPFPermitPath(`/v1/${domain}/notification-details/authorize`), true)
  for (const path of ['/v1/enterprise/people/positions:save', '/v1/enterprise/finance/scheduler:inspect', '/v1/codocs/notification-details/authorize', '/v1/enterprise/altoc/apf-customers:save/more']) assert.equal(isAPFPermitPath(path), false)
})
test('every Go-verified People facts path is signed by the transport', () => {
  const go = readFileSync(new URL('../../data-runtime/internal/server/enterprise_people_facts.go', import.meta.url), 'utf8')
  const block = go.slice(go.indexOf('var enterprisePeopleFactsPaths'), go.indexOf('const enterprisePeopleCallbackPath'))
  const paths = [...block.matchAll(/"(\/v1\/enterprise\/people\/[^"]+)"/gu)].map(m => m[1])
  assert.ok(paths.includes('/v1/enterprise/people/assignments:request-workflow'))
  for (const path of paths) assert.equal(isAPFPermitPath(path), true, path)
  assert.equal(isAPFPermitPath('/v1/enterprise/people/workflow:callback'), false)
})

test('APF TS and Go share the Unicode canonical fixture', () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/enterprise-apf-permit.json', import.meta.url), 'utf8'))
  assert.equal(enterpriseAPFPermitCanonical(fixture.method, fixture.target, fixture.body), fixture.canonical)
})

test('migration queue commands are signed and match the Runtime vectors', () => {
  const f = JSON.parse(readFileSync(new URL('../../data-runtime/internal/server/testdata/enterprise-migration-queue-permit.json', import.meta.url), 'utf8'))
  assert.equal(f.cases.length, 5)
  for (const c of f.cases) {
    assert.equal(enterpriseAPFPermitCanonical(f.method, c.target, c.body), c.canonical)
    const command = c.body.migrationResolve ? 'migrationResolve' : c.body.migrationApply ? 'migrationApply' : 'migrationIdentity'
    for (const key of Object.keys(c.body[command])) {
      const changed = structuredClone(c.body)
      changed[command][key] = key.endsWith('Scope') ? { access: 'self', departmentCodes: [] } : ['expectedVersion', 'limit'].includes(key) ? 99 : 'changed'
      assert.notEqual(enterpriseAPFPermitCanonical(f.method, c.target, changed), c.canonical, key)
    }
  }
})

test('Finance complete command canonical matches Go, preserves decimals and null/absence', () => {
  const f = JSON.parse(readFileSync(new URL('./fixtures/enterprise-finance-permit.json', import.meta.url), 'utf8'))
  assert.equal(enterpriseAPFPermitCanonical(f.method, f.target, f.body), f.canonical)
  const changed = structuredClone(f.body)
  changed.finance.payload.bankName = 'changed'
  assert.notEqual(enterpriseAPFPermitCanonical(f.method, f.target, changed), f.canonical)
  delete changed.finance.payload.bankName
  assert.notEqual(enterpriseAPFPermitCanonical(f.method, f.target, changed), f.canonical)
})

test('Customer parent/child and every field are bound to the Go canonical fixture', () => {
  const f = JSON.parse(readFileSync(new URL('./fixtures/enterprise-customer-permit.json', import.meta.url), 'utf8'))
  assert.equal(enterpriseAPFPermitCanonical(f.method, f.target, f.body), f.canonical)
  for (const key of ['customerId', 'childCode', 'payload']) {
    const changed = structuredClone(f.body)
    changed.customer[key] = key === 'payload' ? { name: 'changed', expectedVersion: 2 } : 'other'
    assert.notEqual(enterpriseAPFPermitCanonical(f.method, f.target, changed), f.canonical)
  }
})

test('Quotation intent binds decimal strings, item order, null, parent and every field to Go', () => {
  const f = JSON.parse(readFileSync(new URL('./fixtures/enterprise-quotation-permit.json', import.meta.url), 'utf8'))
  assert.equal(enterpriseAPFPermitCanonical(f.method, f.target, f.body), f.canonical)
  for (const key of Object.keys(f.body.quotation.items[0])) {
    const changed = structuredClone(f.body)
    changed.quotation.items[0][key] = 'changed'
    assert.notEqual(enterpriseAPFPermitCanonical(f.method, f.target, changed), f.canonical)
  }
  for (const key of ['id', 'customerId', 'version', 'payload']) {
    const changed = structuredClone(f.body)
    changed.quotation[key] = 'changed'
    assert.notEqual(enterpriseAPFPermitCanonical(f.method, f.target, changed), f.canonical)
  }
})

test('Contract nested project authority and business intent share the Go canonical', () => {
  const f = JSON.parse(readFileSync(new URL('./fixtures/enterprise-contract-permit.json', import.meta.url), 'utf8'))
  assert.equal(enterpriseAPFPermitCanonical(f.method, f.target, f.body), f.canonical)
  for (const key of ['actorUid', 'projectCode', 'action', 'scope']) {
    const b = structuredClone(f.body)
    b.contract.aimsPermits[0][key] = key === 'scope' ? { version: 1, masks: [0] } : 'changed'
    assert.notEqual(enterpriseAPFPermitCanonical(f.method, f.target, b), f.canonical)
  }
  const b = structuredClone(f.body)
  b.contract.projects[0].billingScheduleCodes = ['other']
  assert.notEqual(enterpriseAPFPermitCanonical(f.method, f.target, b), f.canonical)
})

test('People field masks and object scopes share Go canonical and bind every fact', () => {
  const f = JSON.parse(readFileSync(new URL('./fixtures/enterprise-people-permit.json', import.meta.url), 'utf8'))
  assert.equal(enterpriseAPFPermitCanonical(f.method, f.target, f.body), f.canonical)
  for (const key of Object.keys(f.body.people)) {
    const b = structuredClone(f.body)
    b.people[key] = key === 'payload' ? { employee_uid: 'forged' } : key === 'costScope' ? { access: 'all', departmentCodes: [] } : 'changed'
    assert.notEqual(enterpriseAPFPermitCanonical(f.method, f.target, b), f.canonical)
  }
})

test('Finance source secondary authorization and original versions are signed as opaque scalar intent', () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/enterprise-finance-permit.json', import.meta.url), 'utf8'))
  fixture.body.finance.payload = { contractId: '1', billingScheduleCode: 'BS1', expectedContractVersion: 2, scheduleVersion: 3, requestedAmount: '10.00', invoiceItem: '中文', altocAuthorization: JSON.stringify({ actorUid: 'person', resource: 'contract', action: 'edit', expiresAt: 100 }) }
  const original = enterpriseAPFPermitCanonical('POST', '/v1/enterprise/finance/invoice-requests:from-altoc', fixture.body)
  for (const field of Object.keys(fixture.body.finance.payload)) {
    const changed = structuredClone(fixture.body)
    changed.finance.payload[field] = 'changed'
    assert.notEqual(enterpriseAPFPermitCanonical('POST', '/v1/enterprise/finance/invoice-requests:from-altoc', changed), original)
  }
  assert.notEqual(enterpriseAPFPermitCanonical('POST', '/v1/enterprise/finance/invoice-approval:request', fixture.body), original)
})

test('Sales convert binds target facts and version to the same Go fixture', () => {
  const f = JSON.parse(readFileSync(new URL('./fixtures/enterprise-sales-permit.json', import.meta.url), 'utf8'))
  assert.equal(enterpriseAPFPermitCanonical(f.method, f.target, f.body), f.canonical)
  for (const key of Object.keys(f.body.sales.payload)) {
    const changed = structuredClone(f.body)
    changed.sales.payload[key] = 'tampered'
    assert.notEqual(enterpriseAPFPermitCanonical(f.method, f.target, changed), f.canonical)
  }
})

test('APF13a nested Finance items have Go object ordering; values and row order remain signed', () => {
  const f = JSON.parse(readFileSync(new URL('./fixtures/enterprise-finance-spend-permit.json', import.meta.url), 'utf8'))
  assert.equal(enterpriseAPFPermitCanonical(f.method, f.target, f.body), f.canonical)
  const changed = structuredClone(f.body)
  changed.finance.payload.items[0].amount = '1.03'
  assert.notEqual(enterpriseAPFPermitCanonical(f.method, f.target, changed), f.canonical)
})

test('Sales support golden binds parent, child, version and all validated fields', () => {
  const f = JSON.parse(readFileSync(new URL('./fixtures/enterprise-sales-support-permit.json', import.meta.url), 'utf8'))
  assert.equal(enterpriseAPFPermitCanonical(f.method, f.target, f.body), f.canonical)
  for (const key of Object.keys(f.body.sales.payload)) {
    const b = structuredClone(f.body)
    b.sales.payload[key] = 'changed'
    assert.notEqual(enterpriseAPFPermitCanonical(f.method, f.target, b), f.canonical)
  }
})

test('Tender canonical binds exact opportunity permission and frozen decimal intent to Go', () => {
  const f = JSON.parse(readFileSync(new URL('./fixtures/enterprise-tender-permit.json', import.meta.url), 'utf8'))
  assert.equal(enterpriseAPFPermitCanonical(f.method, f.target, f.body), f.canonical)
  for (const key of Object.keys(f.body.sales.payload)) {
    const b = structuredClone(f.body)
    b.sales.payload[key] = 'changed'
    assert.notEqual(enterpriseAPFPermitCanonical(f.method, f.target, b), f.canonical)
  }
  assert.equal(isAPFPermitPath('/v1/enterprise/altoc/tenders:delete'), false)
})

test('APF-16b service agreement permit matches the Go golden fixture', async () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/enterprise-service-agreement-permit.json', import.meta.url), 'utf8'))
  assert.equal(enterpriseAPFPermitCanonical(fixture.method, fixture.target, fixture.body), fixture.canonical)
})

test('APF-16c ticket reopen matches Go golden and binds independent action and version', () => {
  const f = JSON.parse(readFileSync(new URL('./fixtures/enterprise-service-ticket-permit.json', import.meta.url), 'utf8'))
  assert.equal(enterpriseAPFPermitCanonical(f.method, f.target, f.body), f.canonical)
  for (const action of ['edit', 'close']) {
    const b = structuredClone(f.body)
    b.authorization.action = action
    assert.notEqual(enterpriseAPFPermitCanonical(f.method, f.target, b), f.canonical)
  }
  const b = structuredClone(f.body)
  b.sales.payload.expectedVersion++
  assert.notEqual(enterpriseAPFPermitCanonical(f.method, f.target, b), f.canonical)
})

test('APF-16d renewal golden binds record scope and forbids opportunity payload laundering', () => {
  const f = JSON.parse(readFileSync(new URL('./fixtures/enterprise-renewal-permit.json', import.meta.url), 'utf8'))
  assert.equal(enterpriseAPFPermitCanonical(f.method, f.target, f.body), f.canonical)
  const body = structuredClone(f.body)
  body.sales.payload.opportunity_id = '1'
  assert.notEqual(enterpriseAPFPermitCanonical(f.method, f.target, body), f.canonical)
})

test('APF14c cost permit matches Runtime and binds CAS, project/month and joint salary range', () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/enterprise-finance-cost-permit.json', import.meta.url), 'utf8'))
  const canonical = () => enterpriseAPFPermitCanonical(fixture.method, fixture.target, fixture.body)
  assert.equal(canonical(), fixture.canonical)
  for (const field of Object.keys(fixture.body.cost)) {
    const copy = structuredClone(fixture.body)
    copy.cost[field] = typeof copy.cost[field] === 'number' ? 99 : 'changed'
    assert.notEqual(enterpriseAPFPermitCanonical(fixture.method, fixture.target, copy), fixture.canonical, field)
  }
  for (const field of ['access', 'projectCodes', 'salary']) {
    const copy = structuredClone(fixture.body)
    copy.authorization.costScope[field] = field === 'salary' ? { access: 'all', departmentCodes: [] } : field === 'projectCodes' ? ['P2'] : 'all'
    assert.notEqual(enterpriseAPFPermitCanonical(fixture.method, fixture.target, copy), fixture.canonical, field)
  }
  const copy = structuredClone(fixture.body)
  copy.authorization.costScope.salary.departmentCodes = ['D1']
  assert.notEqual(enterpriseAPFPermitCanonical(fixture.method, fixture.target, copy), fixture.canonical)
})

test('Feedback freezes source and independent product authorization in the Go canonical', () => {
  const f = JSON.parse(readFileSync(new URL('./fixtures/enterprise-feedback-permit.json', import.meta.url), 'utf8'))
  assert.equal(enterpriseAPFPermitCanonical(f.method, f.target, f.body), f.canonical)
  for (const key of ['expectedSourceSha256', 'productAuthorization']) {
    const b = structuredClone(f.body)
    b.sales.payload[key] = 'changed'
    assert.notEqual(enterpriseAPFPermitCanonical(f.method, f.target, b), f.canonical)
  }
})

test('optional bank-account count authority is bound to the shared Go fixture', () => {
  const f = JSON.parse(readFileSync(new URL('./fixtures/enterprise-finance-account-count-permit.json', import.meta.url), 'utf8'))
  assert.equal(enterpriseAPFPermitCanonical(f.method, f.target, f.body), f.canonical)
  delete f.body.finance.accountCountAllowed
  const old = enterpriseAPFPermitCanonical(f.method, f.target, f.body)
  assert.notEqual(old, f.canonical)
  f.body.finance.accountCountAllowed = false
  assert.equal(enterpriseAPFPermitCanonical(f.method, f.target, f.body), old)
})

test('W3 Finance optional read filters share Go vectors; absent fields preserve old bytes', () => {
  const fixtures = JSON.parse(readFileSync(new URL('./fixtures/enterprise-finance-w3-read-permits.json', import.meta.url), 'utf8'))
  for (const f of fixtures) {
    assert.equal(enterpriseAPFPermitCanonical(f.method, f.target, f.body), f.canonical)
    for (const key of ['legalEntityCode', 'accountType', 'complete']) assert.notEqual(enterpriseAPFPermitCanonical(f.method, f.target, { ...f.body, finance: { ...f.body.finance, [key]: key === 'complete' ? !f.body.finance[key] : 'changed' } }), f.canonical)
  }
  const old = JSON.parse(readFileSync(new URL('./fixtures/enterprise-finance-permit.json', import.meta.url), 'utf8'))
  assert.equal(enterpriseAPFPermitCanonical(old.method, old.target, { ...old.body, finance: { ...old.body.finance, legalEntityCode: '', accountType: '', complete: false } }), old.canonical)
})

test('B4 optional read facts bind every filter and keep legacy bytes unchanged', () => {
  const f = JSON.parse(readFileSync(new URL('../../data-runtime/internal/server/testdata/enterprise-b4-read-permit.json', import.meta.url), 'utf8'))
  for (const c of f.cases) {
    assert.equal(enterpriseAPFPermitCanonical(f.method, c.target, c.body), c.canonical)
    const field = c.body.migrationQuery ? 'migrationQuery' : 'finance'
    for (const key of Object.keys(c.body[field]).filter(key => key !== 'id')) {
      const b = structuredClone(c.body)
      b[field][key] = typeof b[field][key] === 'number' ? 99 : 'changed'
      assert.notEqual(enterpriseAPFPermitCanonical(f.method, c.target, b), c.canonical, key)
    }
  }
  const old = JSON.parse(readFileSync(new URL('./fixtures/enterprise-finance-permit.json', import.meta.url), 'utf8'))
  assert.equal(enterpriseAPFPermitCanonical(old.method, old.target, { ...old.body, finance: { ...old.body.finance, asOfDate: '', staleBefore: '', balanceState: '', currencyCode: '' } }), old.canonical)
})

test('B5-A exact read filters and collection identity share Go golden vectors', () => {
  for (const name of ['read', 'assign']) {
    const f = JSON.parse(readFileSync(new URL(`./fixtures/enterprise-receivable-${name}-permit.json`, import.meta.url), 'utf8'))
    assert.equal(enterpriseAPFPermitCanonical(f.method, f.target, f.body), f.canonical)
    for (const key of Object.keys(f.body.sales.payload)) assert.notEqual(enterpriseAPFPermitCanonical(f.method, f.target, { ...f.body, sales: { ...f.body.sales, payload: { ...f.body.sales.payload, [key]: 'changed' } } }), f.canonical)
  }
})
test('B5B permit binds every allocation line and adjustment version with unchanged legacy bytes', () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/enterprise-finance-b5b-permits.json', import.meta.url), 'utf8'))
  for (const row of fixture.cases) {
    assert.equal(isAPFPermitPath(row.target), true)
    assert.equal(enterpriseAPFPermitCanonical(fixture.method, row.target, row.body), row.canonical)
    const changed = structuredClone(row.body)
    if (changed.finance.payload.items) changed.finance.payload.items[1].amount = '50.00'
    else if (row.target.endsWith(':page')) changed.finance.search = 'changed'
    else changed.finance.payload.expectedVersion++
    assert.notEqual(enterpriseAPFPermitCanonical(fixture.method, row.target, changed), row.canonical)
  }
  const legacy = JSON.parse(readFileSync(new URL('./fixtures/enterprise-finance-permit.json', import.meta.url), 'utf8'))
  assert.equal(enterpriseAPFPermitCanonical(legacy.method, legacy.target, legacy.body), legacy.canonical)
})
