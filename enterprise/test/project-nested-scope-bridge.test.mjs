import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { createServer } from 'node:http'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createApp, createError, createRouter, toNodeListener } from 'h3'

test('nested project reads bind the parent scope and fail before Runtime on dependency or personnel denial', async () => {
  const state = { allowed: true, scopeAllowed: true, unavailable: false, calls: [] }
  globalThis.__nestedProjectReads = state
  globalThis.__nestedProjectError = createError
  const hooks = registerHooks({ resolve(specifier, context, next) {
    let source
    if (specifier.endsWith('/enterpriseRuntimeClient')) source = `
      export const requireEnterpriseUser=async()=>({uid:'reader',tenant:'tenant-a',deployment:'enterprise-test'})
      export const enterpriseRuntimePermitExpiresAt=()=>Date.now()+14000
      export const prepareEnterpriseRuntime=async()=>{}
      export const callEnterpriseRuntime=async (_e,op,input)=>{globalThis.__nestedProjectReads.calls.push({op,input});const s=globalThis.__nestedProjectReads;if(s.planPagination)return {code:0,data:Array.from({length:s.planOverflow||input.query.page==='1'?100:1},(_,id)=>({id}))};return {code:0,data:[]}}
    `
    if (specifier.endsWith('/platformBundleAuthorization')) source = `export const loadAuthorizationSnapshotFromConsoleRuntime=async()=>({resources:globalThis.__nestedProjectReads.allowed?{projects:['view'],work_items:['view'],requirements:['view']}:{},actionPolicies:{}});export const loadScopedAuthorizationFromConsoleRuntime=async()=>{throw new Error("unexpected scoped write authorization in nested read test")}`
    if (specifier.endsWith('/authorizationActions')) source = `export const authorizationResourcesAllow=(resources,resource,action)=>resources[resource]?.includes(action)===true`
    if (specifier === './enterpriseAimsProjects') source = `export const enterpriseAimsNestedProjectReadPermit=async(_event,user,projectId)=>{
      const s=globalThis.__nestedProjectReads
      if(s.unavailable)throw globalThis.__nestedProjectError({statusCode:503,message:'unavailable'})
      if(!s.scopeAllowed)throw globalThis.__nestedProjectError({statusCode:403,message:'denied'})
      return {query:{},authorization:{actorUid:user.uid,tenant:user.tenant,deployment:user.deployment,projectId,resource:'projects',action:'view',hasViewPermission:true,scope:{version:1,masks:[65280]},bundleVersion:'v27',bundleHash:'hash',policyRevision:27,expiresAt:Date.now()+14000}}
    }`
    if (source) return { url: 'data:text/javascript,' + encodeURIComponent(source), shortCircuit: true }
    if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) {
      const path = resolve(dirname(fileURLToPath(context.parentURL)), specifier)
      if (!existsSync(path) && existsSync(path + '.ts')) return { url: pathToFileURL(path + '.ts').href, shortCircuit: true }
    }
    return next(specifier, context)
  } })
  let server
  try {
    const app = createApp(), router = createRouter()
    for (const [route, file, handler] of [
      ['members', 'enterpriseAimsProjectMembers', 'enterpriseAimsProjectMemberList'],
      ['plan', 'enterpriseAimsProjectPlan', 'enterpriseAimsProjectPlan'],
      ['board', 'enterpriseAimsProjectBoard', 'enterpriseAimsProjectBoard'],
      ['requirements', 'enterpriseAimsProjectRequirements', 'enterpriseAimsProjectRequirementList']
    ]) router.get('/projects/:id/' + route, (await import('../server/utils/' + file + '.ts'))[handler])
    app.use(router)
    server = createServer(toNodeListener(app))
    await new Promise(done => server.listen(0, '127.0.0.1', done))
    const base = 'http://127.0.0.1:' + server.address().port
    for (const route of ['members', 'plan', 'board', 'requirements']) {
      state.calls = []
      assert.equal((await fetch(base + '/projects/12/' + route)).status, 200)
      assert.ok(state.calls.length > 0)
      for (const { input } of state.calls) {
        assert.equal(input.projectReadAuthorization.projectId, input.projectId)
        assert.equal(input.projectReadAuthorization.actorUid, 'reader')
        assert.equal(input.projectReadAuthorization.scope.version, 1)
        assert.equal(input.projectReadAuthorization.bundleHash, 'hash')
        assert.equal(input.authorization.action, 'view', 'business permit remains independent')
      }
      for (const [property, status] of [['allowed', 403], ['scopeAllowed', 403], ['unavailable', 503]]) {
        state.calls = []
        state[property] = property === 'unavailable'
        assert.equal((await fetch(base + '/projects/12/' + route)).status, status)
        assert.deepEqual(state.calls, [])
        state[property] = property !== 'unavailable'
      }
      assert.equal((await fetch(base + '/projects/12/' + route + '?projectReadAuthorization=forged')).status, 400)
    }
    state.planPagination = true
    state.calls = []
    const paged = await (await fetch(base + '/projects/12/plan')).json()
    assert.equal(paged.data.milestones.length, 101, 'missing total must continue to page two')
    assert.equal(paged.data.items.length, 101)
    assert.equal(state.calls.length, 4)
    state.planOverflow = true
    assert.equal((await fetch(base + '/projects/12/plan')).status, 503, 'page cap never returns partial plan')
  } finally {
    if (server) await new Promise(done => server.close(done))
    hooks.deregister()
    delete globalThis.__nestedProjectReads
    delete globalThis.__nestedProjectError
  }
})
