import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { businessModules, registerBusinessPages } from '../composition/registry.mjs'

test('APF14c Host compiles fresh joint scopes, exact intent and never accepts browser authority', async () => {
  const root = resolve(import.meta.dirname, '../..')
  const fixture = { calls: [], reads: [], finance: 'view', people: 'none', failure: false, mismatch: false, body: {}, query: { periodMonth: '2026-10' }, project: 'P1', key: 'stable-intent', response: { code: 0, data: { projectCode: 'P1', periodMonth: '2026-10', expectedVersion: 2, inputHash: 'a'.repeat(64), laborCostAmount: '75.00', readiness: 'ready', input_snapshot_json: 'secret', employee_uid: 'private' } } }
  globalThis.__cost = fixture
  const hooks = registerHooks({ resolve(specifier, context, next) {
    let source
    if (specifier === 'h3') source = `export const createError=x=>Object.assign(new Error('fixed'),x);export const getRouterParam=(_e,k)=>k==='projectCode'?globalThis.__cost.project:undefined;export const getQuery=()=>globalThis.__cost.query;export const getHeader=()=>globalThis.__cost.key;export const readBody=async()=>globalThis.__cost.body;export const setHeader=()=>{}`
    if (specifier.endsWith('/enterpriseRuntimeClient')) source = `export const requireEnterpriseUser=async()=>({uid:'Person',tenant:'C000001',deployment:'Host'});export const prepareEnterpriseRuntime=async()=>{};export const enterpriseRuntimePermitExpiresAt=()=>Date.now()+14000;export const callEnterpriseRuntime=async(...args)=>{globalThis.__cost.calls.push(args);return globalThis.__cost.response}`
    if (specifier.endsWith('/platformBundleAuthorization')) source = `export const loadScopedAuthorizationFromConsoleRuntime=async(_e,uid,appCode,required)=>{let f=globalThis.__cost;f.reads.push([appCode,required]);if(f.failure)throw Object.assign(new Error('unavailable'),{statusCode:503});const action=appCode==='finance'?f.finance:f.people;return {uid,appCode,bundleVersion:'1',bundleHash:f.mismatch&&appCode==='people'?'different':'hash',policyRevision:1,authorizationExpiresAt:Date.now()+14000,grants:action==='none'?[]:[{grantId:'g',permissions:[{appCode,resourceCode:required.resourceCode,action}],scopes:appCode==='finance'?[{dimension:'project',predicate:'code',value:'P1'}]:[{dimension:'department',predicate:'tree',value:'D1'}]}]}}`
    if (specifier.endsWith('/directoryApi')) source = `export const fetchConsoleDirectoryApi=async()=>({data:{tree:[{deptCode:'D1',children:[{deptCode:'D2'}]}]}})`
    if (source) return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true }
    let candidate
    if (specifier.startsWith('@hzy/foundation/')) candidate = resolve(root, 'foundation', specifier.slice('@hzy/foundation/'.length))
    else if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) candidate = resolve(dirname(fileURLToPath(context.parentURL)), specifier)
    if (candidate && !existsSync(candidate) && existsSync(`${candidate}.ts`)) return { url: pathToFileURL(`${candidate}.ts`).href, shortCircuit: true }
    return next(specifier, context)
  } })
  try {
    const { enterpriseFinanceCost, normalizeFinanceCost, financeCostPublicResponse, financeCostOperations } = await import('../server/utils/enterpriseFinanceCost.ts')
    assert.equal(Object.keys(financeCostOperations).length, 13)
    fixture.response = { code: 0, data: { data: { project_code: 'P1', labor_cost_amount: '75.00', input_snapshot_json: 'secret', employee_uid: 'private' } } }
    const publicRow = await enterpriseFinanceCost({}, 'project-accounting-view')
    assert.deepEqual(publicRow, { data: { project_code: 'P1', labor_cost_amount: '75.00' } })
    assert.deepEqual(fixture.calls[0][2].authorization.costScope, { access: 'projects', projectCodes: ['P1'], salary: { access: 'none', departmentCodes: [] } })
    assert.equal(fixture.reads.some(r => r[0] === 'people'), false, 'public records never depend on salary permission')
    fixture.project = 'P2'
    await assert.rejects(enterpriseFinanceCost({}, 'project-accounting-view'), { statusCode: 403 })
    fixture.project = 'P1'
    fixture.body = { expectedVersion: 2, expectedInputHash: 'a'.repeat(64) }
    await assert.rejects(enterpriseFinanceCost({}, 'project-labor-recalculate'), { statusCode: 403 })
    fixture.finance = 'admin'
    fixture.response = { code: 0, data: { projectCode: 'P1', periodMonth: '2026-10', expectedVersion: 3, inputHash: 'a'.repeat(64), readiness: 'ready', missingInputs: [], closed: false, employee_uid: 'secret' } }
    await enterpriseFinanceCost({}, 'project-labor-recalculate')
    await enterpriseFinanceCost({}, 'project-labor-recalculate')
    const calls = fixture.calls.slice(-2)
    assert.deepEqual(calls.map(c => c[3].idempotencyKey), ['stable-intent', 'stable-intent'])
    assert.equal(calls[0][1], 'finance.14c-project-labor-recalculate')
    assert.equal(calls[0][2].authorization.objectId, 'P1|2026-10|')
    assert.deepEqual(calls[0][2].cost, { projectCode: 'P1', periodMonth: '2026-10', code: '', page: 0, pageSize: 0, search: '', expectedVersion: 2, expectedInputHash: 'a'.repeat(64) })
    fixture.key = ''
    await assert.rejects(enterpriseFinanceCost({}, 'project-labor-recalculate'), { statusCode: 400 })
    fixture.key = 'stable-intent'
    fixture.query = { periodMonth: '2026-10', page: '1', pageSize: '20' }
    await assert.rejects(enterpriseFinanceCost({}, 'employee-costs-page'), { statusCode: 403 })
    fixture.people = 'view'
    fixture.response = { code: 0, data: { data: [], total: 0, page: 1, pageSize: 20 } }
    await enterpriseFinanceCost({}, 'employee-costs-page')
    assert.deepEqual(fixture.calls.at(-1)[2].authorization.costScope.salary, { access: 'dept', departmentCodes: ['D1', 'D2'] })
    fixture.mismatch = true
    await assert.rejects(enterpriseFinanceCost({}, 'employee-costs-page'), { statusCode: 503 })
    fixture.mismatch = false
    fixture.failure = true
    await assert.rejects(enterpriseFinanceCost({}, 'project-accounting-page'), { statusCode: 503 })
    for (const payload of [{ ...fixture.body, actor: 'fake' }, { ...fixture.body, costScope: {} }, { expectedVersion: -1, expectedInputHash: 'a'.repeat(64) }, { expectedVersion: 2, expectedInputHash: ['a'.repeat(64)] }]) assert.throws(() => normalizeFinanceCost('project-labor-recalculate', { periodMonth: '2026-10' }, 'P1', undefined, payload), { statusCode: 400 })
    for (const query of [{ periodMonth: '2026-13' }, { periodMonth: '2026-10', pageSize: '101' }, { periodMonth: '2026-10', scope: 'all' }, { periodMonth: ['2026-10'] }]) assert.throws(() => normalizeFinanceCost('project-accounting-page', query, undefined, undefined, {}), { statusCode: 400 })
    const scrubbed = financeCostPublicResponse('employee-costs-view', { data: { employee_uid: 'Person', standard_cost_amount: '1500.00', rank_salary: 'secret', source_refs_json: 'secret' } })
    assert.deepEqual(scrubbed, { data: { employee_uid: 'Person', standard_cost_amount: '1500.00' } })
  } finally {
    hooks.deregister()
    delete globalThis.__cost
  }
})

test('APF14c pages, owning endpoints and generated Host routing are exact', () => {
  const paths = ['/finance/project-accounting', '/finance/project-accounting/:projectCode', '/finance/project-cost-allocations', '/finance/project-cost-allocations/:code', '/finance/employee-costs', '/finance/employee-costs/:code']
  const pages = registerBusinessPages([], businessModules, 'placeholder.vue')
  for (const path of paths) assert.equal(pages.find(p => p.path === path)?.meta.authorizationApp, 'finance', path)
  const directory = new URL('../server/routes/finance/api/v1/', import.meta.url)
  const routes = readdirSync(directory, { recursive: true }).filter(file => /(?:project-accounting|project-cost-allocations|employee-costs)\//.test(file) && file.endsWith('.ts'))
  assert.equal(routes.length, 13)
  for (const file of routes) assert.match(readFileSync(new URL(file, directory), 'utf8'), /enterpriseFinanceCost\(event, '[a-z-]+'\)/)
})
