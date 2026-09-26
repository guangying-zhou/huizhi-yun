import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createApp, createRouter, defineEventHandler, toNodeListener } from 'h3'

test('Aims project-member Host bridge retains actor, tenant and project scope', async () => {
  const root = resolve(import.meta.dirname, '../..')
  const calls = []
  const session = { authenticated: true, tokenUse: 'access', subjectType: 'user', uid: 'person-a', tenant: 'tenant-a', deployment: 'enterprise-test' }
  const oldConfig = globalThis.useRuntimeConfig
  globalThis.useRuntimeConfig = () => ({ public: { appCode: 'enterprise' } })
  globalThis.__aimsProjectMemberSession = session
  globalThis.__aimsProjectMemberAllowed = true
  globalThis.__aimsProjectMemberTransport = async (_event, path, options) => {
    calls.push({ path, options })
    return { handled: true, data: { code: 0, data: { items: [] } } }
  }
  const hooks = registerHooks({
    resolve(specifier, context, next) {
      let source
      if (specifier.endsWith('/consoleSessionBridge') || specifier === './consoleSessionBridge') source = 'export const resolveConsoleAuthWithSessionBridge=async()=>globalThis.__aimsProjectMemberSession'
      if (specifier.endsWith('/tenantRuntimeClient') || specifier === './tenantRuntimeClient') source = 'export const maybeCallTenantRuntime=(...args)=>globalThis.__aimsProjectMemberTransport(...args);export const verifiedServiceCommandActor=()=>null;export const prepareTenantRuntime=async()=>true'
      if (specifier.endsWith('/platformBundleAuthorization')) source = "export const loadAuthorizationSnapshotFromConsoleRuntime=async()=>({resources:globalThis.__aimsProjectMemberAllowed?{projects:['view']}:{},actionPolicies:{}});export const loadScopedAuthorizationFromConsoleRuntime=async()=>({grants:[{permissions:[{appCode:'aims',resourceCode:'projects',action:'admin'}],scopes:[{dimension:'project',predicate:'code',value:'PRJ-1'}]}]})"
      if (specifier.endsWith('/directoryApi')) source = "export const fetchDirectoryApi=async(path)=>path.includes('user-departments')?{code:0,data:{primaryDeptCode:'D-1',departments:[]}}:{code:0,data:{tree:[{deptCode:'D-1',name:'研发',children:[]}],flat:[{deptCode:'D-1',name:'研发',managerId:'person-a'}]}};export const fetchConsoleDirectoryApi=fetchDirectoryApi"
      if (source) return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true }
      let candidate
      if (specifier.startsWith('@hzy/foundation/')) candidate = resolve(root, 'foundation', specifier.slice('@hzy/foundation/'.length))
      else if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) candidate = resolve(dirname(fileURLToPath(context.parentURL)), specifier)
      if (candidate && !existsSync(candidate) && existsSync(`${candidate}.ts`)) return { url: pathToFileURL(`${candidate}.ts`).href, shortCircuit: true }
      return next(specifier, context)
    }
  })
  let server
  try {
    const app = createApp()
    const router = createRouter()
    app.use(defineEventHandler(event => { event.context.consoleAuth = session }))
    router.get('/projects/:id/members', (await import('../server/routes/aims/api/v1/projects/[id]/members/index.get.ts')).default)
    app.use(router)
    server = createServer(toNodeListener(app))
    await new Promise(done => server.listen(0, '127.0.0.1', done))
    const base = `http://127.0.0.1:${server.address().port}`

    globalThis.__aimsProjectMemberAllowed = false
    assert.equal((await fetch(`${base}/projects/12/members`)).status, 403)
    assert.equal(calls.length, 0)
    globalThis.__aimsProjectMemberAllowed = true

    assert.equal((await fetch(`${base}/projects/12/members?search=person`)).status, 200)
    const list = calls.at(-1)
    assert.equal(list.path, '/v1/enterprise/aims/project-members:list')
    assert.equal(list.options.scope, 'aims:project-members:view')
    assert.equal(list.options.body.tenant, 'tenant-a')
    assert.equal(list.options.body.projectId, '12')
    assert.equal(list.options.body.authorization.actorUid, 'person-a')
    assert.equal(list.options.body.authorization.resource, 'projects')
    assert.equal(list.options.body.query.current_user_project_admin_project_codes, 'PRJ-1')

    for (const path of ['/projects/12/members?tenant=tenant-b', '/projects/12/members?current_user=person-b', '/projects/0/members', '/projects/01/members']) {
      const before = calls.length
      assert.equal((await fetch(base + path)).status, 400)
      assert.equal(calls.length, before)
    }
  } finally {
    if (server) await new Promise(done => server.close(done))
    hooks.deregister()
    globalThis.useRuntimeConfig = oldConfig
    delete globalThis.__aimsProjectMemberSession
    delete globalThis.__aimsProjectMemberAllowed
    delete globalThis.__aimsProjectMemberTransport
  }
})
