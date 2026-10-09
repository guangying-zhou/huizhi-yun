import assert from 'node:assert/strict'
import test from 'node:test'
import { registerHooks } from 'node:module'
import { readFileSync } from 'node:fs'

test('Host batch derives directory facts after static authorization and freezes only trusted identity/year/key', async () => {
  const state = { denied: false, unavailable: false, requests: [], calls: [], active: [] }
  globalThis.__routineBatch = state
  const mock = code => ({ shortCircuit: true, url: 'data:text/javascript,' + encodeURIComponent(code) })
  const hooks = registerHooks({ resolve(s, c, next) {
    if (s === 'h3') return mock('export const createError=o=>Object.assign(new Error(o.message),o);export const getHeader=(e,k)=>e.headers?.[k];export const getQuery=e=>e.query||{};export const readBody=async e=>e.body')
    if (s === './enterpriseAimsAdminProjects') return mock('export const requireAimsHostAdmin=async()=>{if(globalThis.__routineBatch.denied)throw Object.assign(new Error("denied"),{statusCode:403});return {user:{uid:"U1",tenant:"T1",deployment:"host"},authorization:{actorUid:"U1",resource:"admin",action:"admin"}}}')
    if (s.endsWith('/enterpriseRuntimeClient')) return mock('export const prepareEnterpriseRuntime=async()=>{};export const callEnterpriseRuntime=async(...args)=>{globalThis.__routineBatch.calls.push(args);return {code:0,data:{}}}')
    if (s.endsWith('/directoryApi')) return mock(`
      export const fetchDirectoryActiveStatuses=async(_e,uids)=>{globalThis.__routineBatch.active.push(uids);return uids.map(uid=>({uid,active:uid==='U1'}))}
      export const fetchConsoleDirectoryApi=async(path,options)=>{
        const s=globalThis.__routineBatch;s.requests.push({path,options});if(s.unavailable)return {code:1};
        return path==='/departments'?{code:0,data:{flat:[{deptCode:'D1',name:'部门1',orgType:'department',managerId:'U1'},{deptCode:'D2',name:'部门2',managerId:'inactive'},{deptCode:'X',name:'项目',orgType:'project',managerId:'U1'}]}}:{code:0,data:{items:[{uid:'U1'},{uid:'U2'}],total:2,page:options.params.page,pageSize:100}}
      }`)
    return next(s, c)
  } })
  try {
    const { enterpriseAimsRoutineBatch: batch } = await import('../server/utils/enterpriseAimsRoutineBatch.ts')
    const event = { headers: { 'Idempotency-Key': 'same-year-key' }, body: { year: 2037 } }
    assert.equal((await batch(event)).code, 0)
    const [, op, body, options] = state.calls.at(-1)
    assert.equal(op, 'aims.admin-project-routine-batch')
    assert.equal(options.idempotencyKey, 'same-year-key')
    assert.equal(body.tenant, 'T1')
    assert.equal(body.authorization.actorUid, 'U1')
    assert.deepEqual(body.departments, [{ deptCode: 'D1', name: '部门1', managerUid: 'U1', memberUids: ['U1', 'U2'] }, { deptCode: 'D2', name: '部门2', managerUid: '', memberUids: [] }])
    assert.equal(state.requests.filter(r => r.path === '/users').length, 1)
    for (const invalid of [{ ...event, body: { year: 2037, departments: [] } }, { ...event, headers: {} }, { ...event, body: { year: 2200 } }, { ...event, query: { managerUid: 'U2' } }]) await assert.rejects(batch(invalid), { statusCode: 400 })
    const count = state.requests.length
    state.denied = true
    await assert.rejects(batch(event), { statusCode: 403 })
    assert.equal(state.requests.length, count)
    state.denied = false
    state.unavailable = true
    await assert.rejects(batch(event), { statusCode: 503 })
    assert.equal(state.calls.length, 1)
  } finally {
    hooks.deregister()
    delete globalThis.__routineBatch
  }
})
test('batch and portfolio owning writes use the registry-fenced transaction and receipts, no browser override flags', () => {
  for (const file of ['enterprise_admin_routine_batch.go', 'enterprise_portfolio_create.go']) {
    const source = readFileSync(new URL(`../../data-runtime/internal/apps/aims/${file}`, import.meta.url), 'utf8')
    assert.match(source, /a\.beginEnterpriseWrite\(ctx, identity\)/)
    assert.match(source, /ExecuteInTransaction/)
    assert.match(source, /RequiredCapability = "aims:enterprise-host:execute"/)
    assert.doesNotMatch(source, /a\.DB\(\)\.Exec|trusted.*bool/)
  }
})
