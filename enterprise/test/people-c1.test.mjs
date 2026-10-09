import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { readFileSync } from 'node:fs'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'

test('People c1 strict Host input and fresh scope precede the fixed user channel', async () => {
  const state = { allowed: true, fail: false, calls: [], uid: 'HR' }
  globalThis.__peopleC1 = state
  const hooks = registerHooks({ resolve(specifier, context, next) {
    let source
    if (specifier === 'h3') source = `export const createError=x=>Object.assign(Error('fixed'),x);export const getQuery=()=>({});export const getRouterParam=()=>'';export const getHeader=()=> 'same-key';export const readBody=async()=>({});export const setHeader=()=>{}`
    if (specifier.endsWith('/enterpriseRuntimeClient')) source = `export const requireEnterpriseUser=async()=>({uid:'HR',tenant:'C000001',deployment:'Host'});export const prepareEnterpriseRuntime=async()=>{};export const enterpriseRuntimePermitExpiresAt=()=>Date.now()+15000;export const callEnterpriseRuntime=async(...args)=>{globalThis.__peopleC1.calls.push(args);return {code:0,data:{data:{id:'1',row_version:'1'}}}}`
    if (specifier.endsWith('/platformBundleAuthorization')) source = `export const loadScopedAuthorizationFromConsoleRuntime=async(_e,uid,app,opts)=>{const s=globalThis.__peopleC1;if(s.fail)throw Object.assign(Error('fixed'),{statusCode:503});return {uid:s.uid,appCode:app,bundleVersion:'v1',bundleHash:'hash',policyRevision:1,authorizationExpiresAt:Date.now()+12000,grants:s.allowed&&opts.resourceCode!=='standard_costs'?[{permissions:[{appCode:app,resourceCode:opts.resourceCode,action:opts.action}],scopes:[{dimension:'subject',predicate:'self'}]}]:[]}}`
    if (specifier.endsWith('/directoryApi')) source = `export const fetchConsoleDirectoryApi=async()=>({code:0,data:{tree:[]}})`
    if (specifier.endsWith('/enterprisePeopleFactsPermit')) return next(new URL('../../foundation/server/utils/enterprisePeopleFactsPermit.ts', import.meta.url).href, context)
    if (specifier.endsWith('/peopleScopeProjection')) return next(new URL('../../foundation/server/utils/peopleScopeProjection.ts', import.meta.url).href, context)
    if (specifier === './scopeEvaluator') return next(specifier + '.ts', context)
    if (source) return { url: 'data:text/javascript,' + encodeURIComponent(source), shortCircuit: true }
    return next(specifier, context)
  } })
  try {
    const { normalizePeopleFacts, executePeopleFacts } = await import('../server/utils/enterprisePeopleFacts.ts')
    const facts = normalizePeopleFacts('employees-create', '', { employeeUid: 'Person', display_name: '姓名' })
    await executePeopleFacts({}, 'employees-create', facts, 'same-key')
    assert.equal(state.calls[0][1], 'people.apf09c1-employees-create')
    assert.equal(state.calls[0][2].authorization.scope.access, 'self')
    assert.equal(state.calls[0][2].peopleFacts.sensitiveAllowed, false)
    for (const flag of ['approval_status', 'source_app', 'sensitiveAllowed', 'status']) assert.throws(() => normalizePeopleFacts('employees-create', '', { employeeUid: 'Person', display_name: '姓名', [flag]: 'approved' }), { statusCode: 400 })
    assert.throws(() => normalizePeopleFacts('assignments-update', '1', { employeeUid: 'Person', expectedVersion: 1, workflowInstanceId: '2' }), { statusCode: 400 })
    for (const key of ['allowed', 'fail', 'uid']) {
      state[key] = key === 'uid' ? 'Other' : key === 'allowed' ? false : true
      await assert.rejects(executePeopleFacts({}, 'employees-create', facts, 'same-key'))
      state[key] = key === 'uid' ? 'HR' : key === 'allowed'
    }
    assert.equal(state.calls.length, 1)
  } finally {
    hooks.deregister()
    delete globalThis.__peopleC1
  }
})
for (const name of ['PeopleFactsEditor', 'PeopleOnboardingPage']) test(`${name} compiles and preserves guarded account actions`, () => {
  const source = readFileSync(new URL(`../app/components/${name}.vue`, import.meta.url), 'utf8')
  const { descriptor, errors } = parse(source)
  assert.deepEqual(errors, [])
  const script = compileScript(descriptor, { id: name })
  assert.deepEqual(compileTemplate({ source: descriptor.template.content, filename: name + '.vue', id: name, compilerOptions: { bindingMetadata: script.bindings } }).errors, [])
  for (const fact of ['createConsoleMutationIntent', 'Idempotency-Key', 'expectedVersion', 'USlideover']) assert.ok(source.includes(fact), fact)
  assert.equal(source.includes('onApproved'), false)
  if (name === 'PeopleOnboardingPage') for (const fact of ['provider_code !== \'dingtalk\'', '手工候选暂不支持自动开通，请在 Console 中处理', 'accountIntent', 'refresh-status', 'activation-link']) assert.ok(source.includes(fact), fact)
  else assert.ok(source.includes('暂未开放'))
  if (name === 'PeopleOnboardingPage') for (const fact of ['loadPermissions()', 'hasPermission(\'employees\', \'edit\')', 'useDebouncedSearch', ':loading="pending"', 'CommonEmptyState', 'UPagination', '共 {{ total }} 条']) assert.ok(source.includes(fact), fact)
})
