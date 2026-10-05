import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'

test('admin project bridge requires static admin and keeps its service operations separate', async () => {
  const calls = []
  const deps = {
    snapshot: { resources: { admin: ['admin'] }, actionPolicies: {} },
    scoped: { uid: 'U1', appCode: 'aims', authorizationExpiresAt: Date.now() + 10000,
      grants: [{ grantId: 'static', permissions: [{ appCode: 'aims', resourceCode: 'admin', action: 'admin' }], scopes: [] }] }
  }
  globalThis.__adminProjectDeps = deps
  const hooks = registerHooks({ resolve(s, c, next) {
    const code = s === 'h3'
      ? 'export const createError=o=>Object.assign(new Error(o.message),o);export const getHeader=(e,k)=>e.headers?.[k];export const getQuery=e=>e.query||{};export const getRouterParam=(e,k)=>e.params?.[k];export const readBody=async e=>e.body;export const setHeader=()=>{}'
      : s.endsWith('/enterpriseRuntimeClient')
        ? 'export const requireEnterpriseUser=async()=>({uid:"U1",tenant:"T1",deployment:"host"});export const enterpriseRuntimePermitExpiresAt=()=>Date.now()+14000;export const prepareEnterpriseRuntime=async()=>{};export const callEnterpriseRuntime=async(_e,op,body,options)=>{globalThis.__adminProjectCalls.push({op,body,options});return {code:0,data:{}}}'
        : s.endsWith('/platformBundleAuthorization')
          ? 'export const loadAuthorizationSnapshotFromConsoleRuntime=async()=>globalThis.__adminProjectDeps.snapshot;export const loadScopedAuthorizationFromConsoleRuntime=async()=>globalThis.__adminProjectDeps.scoped'
          : s.endsWith('/scopeEvaluator')
            ? 'export const evaluateFoundationScopedAuthorization=({grants,required})=>({allowed:grants.some(g=>g.permissions.some(p=>p.appCode===required.appCode&&p.resourceCode===required.resourceCode&&p.action===required.action))})'
            : s.endsWith('/authorizationActions')
              ? 'export const authorizationResourcesAllow=(r,resource,action)=>r?.[resource]?.includes(action)===true'
              : s === './enterpriseAimsPersonnel'
                ? 'export const enterpriseAimsPersonnel=async()=>[]'
                : s === './enterpriseAimsProjectUpdate'
                  ? 'export const enterpriseProjectUpdateFields=new Set(["expectedVersion","name","securityLevel","confidentialityLevel","accessWhitelist"])'
                  : null
    return code ? { shortCircuit: true, url: 'data:text/javascript,' + encodeURIComponent(code) } : next(s, c)
  } })
  globalThis.__adminProjectCalls = calls
  try {
    const { enterpriseAimsAdminProjectList: list, enterpriseAimsAdminProjectUpdate: update } = await import('../server/utils/enterpriseAimsAdminProjects.ts')
    assert.equal((await list({ query: { page: '1', pageSize: '20' } })).code, 0)
    assert.equal(calls.at(-1).op, 'aims.admin-project-list')
    assert.equal(calls.at(-1).body.authorization.mode, 'admin-static')
    const edit = { params: { id: '7' }, headers: { 'Idempotency-Key': 'marked-7' }, body: { expectedVersion: 'a'.repeat(64), name: '标记' } }
    assert.equal((await update(edit)).code, 0)
    assert.equal(calls.at(-1).op, 'aims.admin-project-update')
    assert.equal(calls.at(-1).body.authorization.projectId, '7')
    assert.equal(calls.at(-1).options.idempotencyKey, 'marked-7')
    const count = calls.length
    deps.scoped = { ...deps.scoped, grants: [{ ...deps.scoped.grants[0], scopes: [{ dimension: 'project', predicate: 'code', value: 'P7' }] }] }
    await assert.rejects(list({ query: {} }), { statusCode: 403 })
    assert.equal(calls.length, count)
    deps.scoped = { ...deps.scoped, grants: [{ ...deps.scoped.grants[0], scopes: [] }] }
    deps.snapshot = { resources: { projects: ['edit'] } }
    await assert.rejects(update(edit), { statusCode: 403 })
    assert.equal(calls.length, count)
  } finally {
    hooks.deregister()
    delete globalThis.__adminProjectDeps
    delete globalThis.__adminProjectCalls
  }
})
