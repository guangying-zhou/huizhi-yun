import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { readFileSync } from 'node:fs'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'

test('Contract operations bind contract permission and signed Aims intent; browser facts fail before Runtime', async () => {
  const calls = []
  globalThis.__contract = { calls, id: '1', query: {}, body: { expectedVersion: 2, name: '合同' }, allowed: true }
  const hooks = registerHooks({ resolve(specifier, context, next) {
    let source
    if (specifier === 'h3') source = `export const createError=x=>Object.assign(Error('fixed'),x);export const getRouterParam=()=>globalThis.__contract.id;export const getQuery=()=>globalThis.__contract.query;export const getHeader=()=> 'stable-key';export const readBody=async()=>globalThis.__contract.body;export const setHeader=()=>{}`
    if (specifier.endsWith('/enterpriseRuntimeClient')) source = `export const requireEnterpriseUser=async()=>({uid:'Person',tenant:'C000001',deployment:'Host'});export const prepareEnterpriseRuntime=async()=>true;export const callEnterpriseRuntime=async(...a)=>{globalThis.__contract.calls.push(a);return {code:0,data:{data:{id:1}}}}`
    if (specifier.endsWith('/projectCommandAuthorization')) source = `export const loadProjectCommandAuthorization=async(_e,u,p)=>{if(!globalThis.__contract.allowed)throw Object.assign(Error('fixed'),{statusCode:403});return {...u,...p,actorUid:u.uid,allowed:true,expiresAt:123,bundleVersion:'1',bundleHash:'hash',policyRevision:1,scope:{version:1,masks:[65535],project_codes:[],department_codes:[],department_tree_roots:[]}}}`
    if (specifier === './enterpriseAPF') source = `export const buildAPFPermit=async(_e,d,o,i,u,resource,action)=>({actorUid:u.uid,tenant:u.tenant,deployment:u.deployment,objectId:i.id,resource,action:action||(o==='save'?'edit':'view')})`
    if (specifier === './enterpriseAltocReads') source = `export const projectAltocReadData=x=>x`
    if (source) return { url: 'data:text/javascript,' + encodeURIComponent(source), shortCircuit: true }
    return next(specifier, context)
  } })
  try {
    const { enterpriseAltocContract, contractOperations, normalizeContractRequest } = await import('../server/utils/enterpriseAltocContracts.ts')
    assert.equal(contractOperations.length, 16)
    await enterpriseAltocContract({}, 'contracts-update')
    assert.equal(calls[0][1], 'altoc.wp4c-contracts-update')
    assert.equal(calls[0][2].authorization.resource, 'contract')
    assert.equal(calls[0][2].authorization.objectId, '1||')
    for (const field of ['status', 'approved_by', 'aimsPermits', 'owner_uid']) {
      globalThis.__contract.body = { expectedVersion: 2, [field]: 'fake' }
      await assert.rejects(enterpriseAltocContract({}, 'contracts-update'), { statusCode: 400 })
    }
    const projects = [{ projectCode: 'MARKED-P', name: '标记项目', deptCode: 'D1', create: true, lineCodes: ['CL-1'], obligationCodes: [], billingScheduleCodes: ['BS-1'] }]
    globalThis.__contract.body = { expectedVersion: 2, projects }
    await enterpriseAltocContract({}, 'contract-projects-bind')
    assert.deepEqual(calls[1][2].contract.aimsPermits.map(a => [a.resource, a.action]), [['projects', 'create'], ['projects', 'edit']])
    assert.equal(calls[1][2].contract.aimsPermits[0].actorUid, 'Person')
    assert.equal(calls[1][3].idempotencyKey, 'stable-key')
    globalThis.__contract.allowed = false
    await assert.rejects(enterpriseAltocContract({}, 'contract-projects-bind'), { statusCode: 403 })
    for (const code of ['../X', 'abc', 'A/B']) assert.throws(() => normalizeContractRequest('contract-projects-bind', '1', { expectedVersion: 1, projects: [{ ...projects[0], projectCode: code }] }), { statusCode: 400 })
    assert.equal(calls.length, 2)
    // Follow-up commands for imported contracts: annotate is an edit; completing
    // or terminating must carry an explicit contract:close permit.
    globalThis.__contract.allowed = true
    globalThis.__contract.body = { expectedVersion: 2, remark: '补充说明', contact_id: '7' }
    await enterpriseAltocContract({}, 'contracts-annotate')
    assert.deepEqual([calls[2][1], calls[2][2].authorization.action, calls[2][2].authorization.operation], ['altoc.wp4c-contracts-annotate', 'edit', 'contracts-annotate'])
    assert.deepEqual(calls[2][2].contract.payload, { expectedVersion: 2, remark: '补充说明', contact_id: '7' })
    globalThis.__contract.body = { expectedVersion: 2 }
    await enterpriseAltocContract({}, 'contracts-complete')
    globalThis.__contract.body = { expectedVersion: 2, reason: '客户取消' }
    await enterpriseAltocContract({}, 'contracts-terminate')
    assert.deepEqual(calls.slice(3).map(c => [c[1], c[2].authorization.resource, c[2].authorization.action, c[3].idempotencyKey]), [['altoc.wp4c-contracts-complete', 'contract', 'close', 'stable-key'], ['altoc.wp4c-contracts-terminate', 'contract', 'close', 'stable-key']])
    for (const [operation, body] of [['contracts-annotate', { expectedVersion: 2, status: 'completed' }], ['contracts-annotate', { expectedVersion: 2, name: '改名' }], ['contracts-complete', { expectedVersion: 2, remark: 'x' }], ['contracts-terminate', { expectedVersion: 2, status: 'terminated' }], ['contracts-complete', { expectedVersion: 2, rows: [] }]]) {
      globalThis.__contract.body = body
      await assert.rejects(enterpriseAltocContract({}, operation), { statusCode: 400 })
    }
    assert.equal(calls.length, 5)
    // Reassigning the owner is an edit that carries only the owner fields.
    globalThis.__contract.body = { expectedVersion: 2, owner_uid: 'person-b', owner_dept_code: 'D-1' }
    await enterpriseAltocContract({}, 'contracts-set-owner')
    assert.deepEqual([calls[5][1], calls[5][2].authorization.action, calls[5][2].contract.payload], ['altoc.wp4c-contracts-set-owner', 'edit', { expectedVersion: 2, owner_uid: 'person-b', owner_dept_code: 'D-1' }])
    for (const body of [{ expectedVersion: 2, owner_uid: 'person-b', status: 'effective' }, { expectedVersion: 2, owner_uid: 'person-b', name: '改名' }]) {
      globalThis.__contract.body = body
      await assert.rejects(enterpriseAltocContract({}, 'contracts-set-owner'), { statusCode: 400 })
    }
  } finally {
    hooks.deregister()
    delete globalThis.__contract
  }
})
test('Contract page compiles and preserves totals, stable intent and server approval boundary', () => {
  const source = readFileSync(new URL('../app/components/AltocContractsPage.vue', import.meta.url), 'utf8')
  const { descriptor, errors } = parse(source)
  assert.deepEqual(errors, [])
  const script = compileScript(descriptor, { id: 'contract-page' })
  const result = compileTemplate({ source: descriptor.template.content, filename: 'AltocContractsPage.vue', id: 'contract-page', compilerOptions: { bindingMetadata: script.bindings } })
  assert.deepEqual(result.errors, [])
  for (const fact of [':total="total"', '共 {{ total }} 条', 'expectedVersion', 'Idempotency-Key', 'createConsoleMutationIntent', 'useConfirm', 'billingScheduleCodes', 'payment_terms', 'obligations', '已批准', '正式审批流程', 'accessStatus', 'cacheScope']) assert.ok(source.includes(fact), fact)
  assert.equal(source.includes('action(\'approve\''), false)
})
