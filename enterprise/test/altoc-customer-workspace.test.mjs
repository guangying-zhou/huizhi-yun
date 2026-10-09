import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { altocReadFields, altocContractChildFields, altocQuotationItemFields } from '../shared/altoc-basic-read.ts'
import { w3SnapshotFields, w3SourceFields } from '../shared/w3-read-projection.ts'

const ts = createRequire(import.meta.url)('typescript')
function harness() {
  const source = readFileSync(new URL('../server/utils/enterpriseAltocReads.ts', import.meta.url), 'utf8')
  const program = ts.createSourceFile('reader.ts', source, ts.ScriptTarget.Latest, true)
  const script = program.statements.filter(node => !ts.isImportDeclaration(node)).map(node => node.getText(program).replace(/^export /, '')).join('\n')
  const code = ts.transpileModule(script + '\nreturn { enterpriseAltocRead, projectCustomerContactPage }', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  const state = { query: {}, permission: true, calls: [], result: { code: 0, data: { id: '1', items: [{ id: 2, customer_id: 1, name: '合成联系人', secret: 'never-forward', source_info: { importedAt: '2026-01-01', secret: 'never-forward' } }], total: 1, page: 1, pageSize: 20 } } }
  const context = {
    createError: value => Object.assign(Error('fixed'), value), getQuery: () => state.query, getRouterParam: () => '1', setHeader: () => {},
    requireEnterpriseUser: async () => ({ uid: 'synthetic-user', tenant: 'synthetic-tenant', deployment: 'synthetic-deployment' }),
    loadAuthorizationSnapshotFromConsoleRuntime: async () => ({ resources: {} }), authorizationResourcesAllow: () => state.permission,
    prepareEnterpriseRuntime: async () => {}, enterpriseRuntimePermitExpiresAt: () => Date.now() + 60000,
    loadScopedAuthorizationFromConsoleRuntime: async () => ({ uid: 'synthetic-user', appCode: 'altoc', roles: [], grants: [], bundleVersion: '1', bundleHash: 'synthetic-hash', policyRevision: 1, authorizationExpiresAt: Date.now() + 60000 }),
    evaluateFoundationScopedAuthorization: () => ({ allowed: state.permission }), hasAltocGlobalAdminRole: () => false,
    resolveAltocDataAccessQueryFromScopedGrants: () => ({ current_user_altoc_access: 'self' }), scopedGrantsNeedAltocDepartmentTree: () => false,
    callEnterpriseRuntime: async (...args) => {
      state.calls.push(args)
      return state.result
    },
    altocReadFields, altocContractChildFields, altocQuotationItemFields, w3SnapshotFields, w3SourceFields
  }
  return { state, ...new Function(...Object.keys(context), code)(...Object.values(context)) }
}
test('customer contacts bridge binds owner, paging and current scoped permit before Runtime; projection excludes secrets', async () => {
  const h = harness()
  h.state.query = { decisionRole: 'buyer', starredOnly: 'true' }
  const result = await h.enterpriseAltocRead({}, 'customer', true, undefined, true)
  assert.equal(h.state.calls[0][1], 'altoc.customer-view')
  const input = h.state.calls[0][2]
  assert.equal(input.id, '1')
  assert.equal(input.query.contactsOnly, true)
  assert.equal(input.query.starredOnly, true)
  assert.equal(input.authorization.scope.access, 'self')
  assert.deepEqual(input.authorization.query, input.query)
  assert.equal(JSON.stringify(result).includes('never-forward'), false)
  h.state.permission = false
  await assert.rejects(h.enterpriseAltocRead({}, 'customer', true, undefined, true), { statusCode: 403 })
  assert.equal(h.state.calls.length, 1)
})
test('customer filter validation rejects unknown sort, invalid dates, mixed contacts/list filters before Runtime', async () => {
  const h = harness()
  for (const query of [{ customerSort: 'name;drop' }, { updatedDateFrom: '2026-02-30' }, { updatedDateFrom: '2026-02-02', updatedDateTo: '2026-01-01' }, { ownerUid: 'u', ownerUnassigned: 'true' }, { unknown: 'true' }]) {
    h.state.query = query
    await assert.rejects(h.enterpriseAltocRead({}, 'customer', false), { statusCode: 400 })
  }
  h.state.query = { ownerUid: 'u' }
  await assert.rejects(h.enterpriseAltocRead({}, 'customer', true, undefined, true), { statusCode: 400 })
  assert.equal(h.state.calls.length, 0)
})
test('contact projection rejects cross-owner rows, malformed totals and mismatched pages', () => {
  const h = harness()
  const data = h.state.result.data
  for (const bad of [{ ...data, id: '2' }, { ...data, total: -1 }, { ...data, page: 2 }, { ...data, items: [{ id: 2, customer_id: 2 }] }]) {
    assert.throws(() => h.projectCustomerContactPage(bad, '1', { page: 1, pageSize: 20 }), { statusCode: 503 })
  }
})
