import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

test('HR source BFF freshly gates each stage and cannot accept a browser confirmation/source', async () => {
  const root = resolve(import.meta.dirname, '../..')
  const calls = []
  const tuple = { mappings: ['admin', 'people.hr-source-sync.dingtalk.department-mappings.apply'] }
  globalThis.__hr = { calls, body: { expectedVersion: 1, command: { mappings: [{ externalDepartmentId: '123', canonicalDeptCode: 'A' }] } }, scope: 'all', fail: false, targetFail: false, targetCalls: 0, confirmed: 0 }
  const h = registerHooks({ resolve(s, c, next) {
    let code
    if (s === 'h3') code = `export const createError=x=>Object.assign(new Error('fixed'),x);export const getQuery=()=>({});export const getRouterParam=()=>'';export const getHeader=()=> 'stable-key';export const readBody=async()=>globalThis.__hr.body;export const setHeader=()=>{}`
    if (s.endsWith('/enterpriseRuntimeClient')) code = `export const requireEnterpriseUser=async()=>({uid:'HR',tenant:'C000001',deployment:'Host'});export const prepareEnterpriseRuntime=async()=>{};export const enterpriseRuntimePermitExpiresAt=()=>Date.now()+14000;export const callEnterpriseRuntime=async(e,op,body,options)=>{globalThis.__hr.calls.push({op,body,options});if(op.endsWith('-confirm')){globalThis.__hr.confirmed++;return {code:0,data:{data:{status:'succeeded',operationKey:'frozen'}}}}return {code:0,data:{data:{operationKey:'frozen',frozen:{operationCode:'people.hr-source-sync.dingtalk.department-mappings.apply',commandSha256:'hash'}}}}}`
    if (s.endsWith('/platformBundleAuthorization')) code = `export const loadScopedAuthorizationFromConsoleRuntime=async(e,uid,appCode,required)=>{if(globalThis.__hr.fail)throw Object.assign(Error('dependency'),{statusCode:503});return {uid,appCode,bundleVersion:'v1',bundleHash:'h',policyRevision:41,authorizationExpiresAt:Date.now()+14000,grants:[],actionPolicy:{}}}`
    if (s.endsWith('/peopleScopeProjection')) code = `export const projectPeopleReadScope=()=>({access:globalThis.__hr.scope,departmentCodes:[]})`
    if (s.endsWith('/enterpriseHRSourceCommand')) code = `export const hrSourceTargets=${JSON.stringify(tuple)};export const readHRSource=()=>{};export const callHRSourceCommand=async()=>{globalThis.__hr.targetCalls++;if(globalThis.__hr.targetFail)throw Object.assign(Error('target'),{statusCode:503});return {aliases:[]}}`
    if (code) return { url: 'data:text/javascript,' + encodeURIComponent(code), shortCircuit: true }
    let candidate
    if (s.startsWith('@hzy/foundation/')) candidate = resolve(root, 'foundation', s.slice('@hzy/foundation/'.length))
    else if (s.startsWith('.') && c.parentURL?.startsWith('file:')) candidate = resolve(dirname(fileURLToPath(c.parentURL)), s)
    if (candidate && !existsSync(candidate) && existsSync(candidate + '.ts')) return { url: pathToFileURL(candidate + '.ts').href, shortCircuit: true }
    return next(s, c)
  } })
  try {
    const { enterprisePeopleHRWrite } = await import('../server/utils/enterprisePeopleHRSource.ts')
    await enterprisePeopleHRWrite({}, 'mappings')
    assert.equal(calls.length, 2)
    assert.equal(calls[0].body.authorization.resource, 'hr_source_sync')
    assert.equal(calls[0].body.authorization.action, 'admin')
    assert.equal(calls[0].body.authorization.actorUid, 'HR')
    assert.equal(calls[1].body.peopleFacts.payload.confirmation.targetConfirmed, true)
    globalThis.__hr.scope = 'none'
    await assert.rejects(enterprisePeopleHRWrite({}, 'mappings'), { statusCode: 403 })
    assert.equal(calls.length, 2)
    globalThis.__hr.scope = 'all'
    globalThis.__hr.fail = true
    await assert.rejects(enterprisePeopleHRWrite({}, 'mappings'), { statusCode: 503 })
    globalThis.__hr.fail = false
    globalThis.__hr.targetFail = true
    await assert.rejects(enterprisePeopleHRWrite({}, 'mappings'), { statusCode: 503 })
    assert.equal(globalThis.__hr.confirmed, 1, 'no false confirmation')
    globalThis.__hr.body = { ...globalThis.__hr.body, confirmation: { targetConfirmed: true } }
    await assert.rejects(enterprisePeopleHRWrite({}, 'mappings'), { statusCode: 400 })
  } finally {
    h.deregister()
    delete globalThis.__hr
  }
})
test('HR source page separates permissions, original intent restoration and pending source gate', () => {
  const s = readFileSync(new URL('../app/components/PeopleHRSourcePage.vue', import.meta.url), 'utf8')
  for (const action of ['view', 'admin', 'execute']) assert.ok(s.includes(`hasPermission('hr_source_sync', '${action}')`))
  for (const marker of ['loadPermissions()', '权限信息加载失败', 'state.remapPending', 'intent.submit', 'Idempotency-Key', 'expectedVersion', '按原键恢复', '<ContentPageHeader', '<CommonEmptyState', ':loading="pending"', 'tone: \'warning\'']) assert.ok(s.includes(marker), marker)
  assert.doesNotMatch(s, /useLocalStorage|localStorage|sessionStorage|\bv-show=/)
  const route = readFileSync(new URL('../server/utils/enterprisePeopleHRSource.ts', import.meta.url), 'utf8')
  assert.ok(route.indexOf('callHRSourceCommand(event') < route.indexOf('targetConfirmed: true'))
  assert.doesNotMatch(route, /sourceApp:\s*'people'|sourceClientId:\s*'people.runtime'|actorUid:.*raw/)
})
