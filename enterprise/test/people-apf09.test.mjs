import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { readFileSync } from 'node:fs'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'

test('People Host signs separate cost mask and scope; browser facts and dependency failures precede Runtime', async () => {
  globalThis.__people09 = { calls: [], uid: 'Person', resource: 'employees', allow: true, cost: false, fail: false, id: '', query: { page: 1, pageSize: 20 } }
  const hooks = registerHooks({ resolve(specifier, context, next) {
    let source
    if (specifier === 'h3')
      source = `export const createError=x=>Object.assign(Error('fixed'),x);export const getQuery=()=>globalThis.__people09.query;export const getRouterParam=()=>globalThis.__people09.id;export const getHeader=()=> 'key';export const readBody=async()=>globalThis.__people09.body;export const setHeader=()=>{}`
    if (specifier.endsWith('/enterpriseRuntimeClient'))
      source = `export const requireEnterpriseUser=async()=>({uid:'Person',tenant:'C000001',deployment:'Host'});export const prepareEnterpriseRuntime=async()=>{};export const enterpriseRuntimePermitExpiresAt=()=>Date.now()+15000;export const callEnterpriseRuntime=async(...args)=>{globalThis.__people09.calls.push(args);return {code:0,data:{data:globalThis.__people09.rows||[]}}}`
    if (specifier.endsWith('/platformBundleAuthorization'))
      source = `export const loadScopedAuthorizationFromConsoleRuntime=async(_e,uid,app,opts)=>{const s=globalThis.__people09;if(s.fail)throw Object.assign(Error('fixed'),{statusCode:503});const allow=opts.resourceCode==='standard_costs'?s.cost:s.allow;return {uid:s.uid,appCode:app,bundleVersion:'v1',bundleHash:'hash',policyRevision:1,authorizationExpiresAt:Date.now()+12000,grants:allow?[{grantId:'g',permissions:[{appCode:app,resourceCode:opts.resourceCode,action:opts.action}],scopes:[{dimension:'subject',predicate:'self'}]}]:[]}}`
    if (specifier.endsWith('/directoryApi'))
      source = `export const fetchConsoleDirectoryApi=async()=>({code:0,data:{tree:[]}})`
    if (specifier === './scopeEvaluator' || specifier === './peopleScopeProjection')
      return next(specifier + '.ts', context)
    if (source)
      return { url: 'data:text/javascript,' + encodeURIComponent(source), shortCircuit: true }
    return next(specifier, context)
  } })
  try {
    const { enterprisePeople, normalizePeopleRequest, peopleOperations, readEnterprisePeopleAssignmentByCode } = await import('../server/utils/enterprisePeople.ts')
    assert.equal(Object.keys(peopleOperations).length, 18)
    await enterprisePeople({}, 'employees-search')
    let b = globalThis.__people09.calls[0][2]
    assert.equal(b.people.costAllowed, false)
    assert.equal(b.authorization.scope.access, 'self')
    assert.equal(b.authorization.resource, 'employees')
    globalThis.__people09.cost = true
    await enterprisePeople({}, 'employees-search')
    b = globalThis.__people09.calls[1][2]
    assert.equal(b.people.costAllowed, true)
    assert.equal(b.people.costScope.access, 'self')
    for (const [key, value] of [['uid', 'other'], ['allow', false], ['fail', true]]) {
      globalThis.__people09[key] = value
      await assert.rejects(enterprisePeople({}, 'employees-search'))
      globalThis.__people09[key] = key === 'uid' ? 'Person' : key === 'allow' ? true : false
    }
    assert.equal(globalThis.__people09.calls.length, 2)
    globalThis.__people09.id = 'Person'
    globalThis.__people09.query = {}
    await enterprisePeople({}, 'employees-private-view')
    assert.equal(globalThis.__people09.calls[2][2].authorization.action, 'edit')
    assert.equal(globalThis.__people09.calls[2][2].people.costAllowed, false)
    globalThis.__people09.body = { expectedVersion: 2, major: '设计' }
    await enterprisePeople({}, 'employees-private-update')
    assert.equal(globalThis.__people09.calls[3][3].idempotencyKey, 'key')
    globalThis.__people09.body = { expectedVersion: 2, source_code: 'dingtalk' }
    await assert.rejects(enterprisePeople({}, 'employees-private-update'), { statusCode: 400 })
    assert.equal(globalThis.__people09.calls.length, 4)
    const code = 'ASN-' + 'a'.repeat(32)
    globalThis.__people09.rows = [{ id: 7, assignment_code: code }, { id: 8, assignment_code: code + 'x' }]
    assert.equal((await readEnterprisePeopleAssignmentByCode({}, code)).id, 7)
    const lookup = globalThis.__people09.calls.at(-1)
    assert.equal(lookup[1], 'people.apf09-assignments-list')
    assert.equal(lookup[2].people.search, code)
    assert.equal(lookup[2].authorization.resource, 'assignments')
    assert.equal(lookup[2].authorization.scope.access, 'self')
    globalThis.__people09.rows = [{ id: 8, assignment_code: code + 'x' }]
    await assert.rejects(readEnterprisePeopleAssignmentByCode({}, code), { statusCode: 403 })
    globalThis.__people09.allow = false
    const before = globalThis.__people09.calls.length
    await assert.rejects(readEnterprisePeopleAssignmentByCode({}, code), { statusCode: 403 })
    assert.equal(globalThis.__people09.calls.length, before)
    globalThis.__people09.allow = true
    globalThis.__people09.fail = true
    await assert.rejects(readEnterprisePeopleAssignmentByCode({}, code), { statusCode: 503 })
    globalThis.__people09.fail = false

    assert.throws(() => normalizePeopleRequest('employees-search', { costAllowed: 'true' }, undefined, {}))
    assert.throws(() => normalizePeopleRequest('positions-create', {}, undefined, { position_code: 'P', position_name: 'Name', actor: 'other' }))
    assert.throws(() => normalizePeopleRequest('positions-update', {}, '1', { position_code: 'P', position_name: 'Name' }))
  } finally {
    hooks.deregister()
    delete globalThis.__people09
  }
})
for (const name of ['PeopleMasterPage', 'PeopleReadPage'])
  test(`${name} compiles, loads permissions and preserves safe responsive list contract`, () => {
    const source = readFileSync(new URL(`../app/components/${name}.vue`, import.meta.url), 'utf8')
    const { descriptor, errors } = parse(source)
    assert.deepEqual(errors, [])
    const script = compileScript(descriptor, { id: name })
    assert.deepEqual(compileTemplate({ source: descriptor.template.content, filename: name + '.vue', id: name, compilerOptions: { bindingMetadata: script.bindings } }).errors, [])
    for (const fact of ['loadPermissions()', 'hasPermission(', 'useDebouncedSearch', 'UPagination', ':total="total"', '共 {{ total }} 条', 'CommonEmptyState', '权限信息加载失败'])
      assert.ok(source.includes(fact), fact)
    if (name === 'PeopleMasterPage') {
      for (const fact of ['createConsoleMutationIntent', 'expectedVersion', 'Idempotency-Key', 'USlideover', '无权查看 Finance 成本参数', '序列数量由 Console 系统参数维护'])
        assert.ok(source.includes(fact), fact)
    } else {
      assert.ok(source.includes('暂未开放'))
      assert.equal(source.includes('readBody'), false)
    }
  })

test('Private profile UI compiles, only loads on authorized opt-in and does not submit masks unchanged', () => {
  const name = 'PeoplePrivateProfile'
  const source = readFileSync(new URL('../app/components/PeoplePrivateProfile.vue', import.meta.url), 'utf8')
  const { descriptor, errors } = parse(source)
  assert.deepEqual(errors, [])
  const script = compileScript(descriptor, { id: name })
  assert.deepEqual(compileTemplate({ source: descriptor.template.content, filename: name + '.vue', id: name, compilerOptions: { bindingMetadata: script.bindings } }).errors, [])
  for (const fact of ['props.allowed', 'open.value', 'Idempotency-Key', 'expectedVersion', 'facts.value[key]?.readOnly', 'draft[key] ===', 'autocomplete="off"'])
    assert.ok(source.includes(fact), fact)
  assert.equal(source.includes('localStorage'), false)
})
