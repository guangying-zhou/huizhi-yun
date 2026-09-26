import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createApp, createRouter, defineEventHandler, toNodeListener } from 'h3'

test('Aims project Host bridge binds the actor and scoped project-admin projection', async () => {
  const root = resolve(import.meta.dirname, '../..')
  const calls = []
  const session = { authenticated: true, tokenUse: 'access', subjectType: 'user', uid: 'person-a', tenant: 'tenant-a', deployment: 'enterprise-test' }
  const oldConfig = globalThis.useRuntimeConfig
  globalThis.useRuntimeConfig = () => ({ public: { appCode: 'enterprise' } })
  globalThis.__aimsProjectSession = session
  globalThis.__aimsProjectPermissions = async () => ({ resources: { projects: ['view'] } })
  globalThis.__aimsProjectTransport = async (_event, path, options) => {
    calls.push({ path, options })
    return { handled: true, data: { code: 0, data: path.endsWith(':list') ? { items: [], total: 0 } : { id: 12, name: '项目 A' } } }
  }
  const hooks = registerHooks({
    resolve(specifier, context, next) {
      let source
      if (specifier.endsWith('/consoleSessionBridge') || specifier === './consoleSessionBridge') source = 'export const resolveConsoleAuthWithSessionBridge=async()=>globalThis.__aimsProjectSession'
      if (specifier.endsWith('/tenantRuntimeClient') || specifier === './tenantRuntimeClient') source = 'export const maybeCallTenantRuntime=(...args)=>globalThis.__aimsProjectTransport(...args);export const verifiedServiceCommandActor=()=>null;export const prepareTenantRuntime=async()=>true'
      if (specifier.endsWith('/platformBundleAuthorization')) source = "export const loadScopedAuthorizationFromConsoleRuntime=async()=>({grants:[{permissions:[{appCode:'aims',resourceCode:'projects',action:'admin'}],scopes:[{dimension:'project',predicate:'code',value:'PRJ-1'}]}]});export const loadAuthorizationSnapshotFromConsoleRuntime=async()=>globalThis.__aimsProjectPermissions()"
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
    router.get('/projects', (await import('../server/routes/aims/api/v1/projects/index.get.ts')).default)
    router.get('/projects/:id', (await import('../server/routes/aims/api/v1/projects/[id].get.ts')).default)
    app.use(router)
    server = createServer(toNodeListener(app))
    await new Promise(done => server.listen(0, '127.0.0.1', done))
    const base = `http://127.0.0.1:${server.address().port}`

    assert.equal((await fetch(`${base}/projects?actor=forged`)).status, 400)
    assert.equal(calls.length, 0)
    assert.equal((await fetch(`${base}/projects?page=2&search=alpha`)).status, 200)
    const list = calls.at(-1)
    assert.equal(list.path, '/v1/enterprise/aims/projects:list')
    assert.equal(list.options.appCode, 'enterprise')
    assert.equal(list.options.scope, 'aims:projects:view')
    assert.equal(list.options.body.authorization.actorUid, 'person-a')
    assert.equal(list.options.body.authorization.deployment, 'enterprise-test')
    assert.deepEqual(list.options.body.query, {
      page: '2', search: 'alpha', current_user_dept_codes: 'D-1', current_user_management_dept_codes: 'D-1', current_user_project_admin_project_codes: 'PRJ-1'
    })
    assert.equal((await fetch(`${base}/projects/12`)).status, 200)
    const detail = calls.at(-1)
    assert.equal(detail.path, '/v1/enterprise/aims/projects:view')
    assert.equal(detail.options.body.projectId, '12')
    assert.equal(detail.options.body.authorization.actorUid, 'person-a')
    // Without aims projects:view no permit is issued; a Console authorization
    // outage is 503, never a disguised 403.
    for (const [permissions, status] of [
      [async () => ({ resources: {} }), 403],
      [async () => ({ resources: { projects: [] } }), 403],
      [async () => ({ resources: { work_items: ['view'] } }), 403],
      [async () => { throw Object.assign(new Error('console unavailable'), { statusCode: 503 }) }, 503]
    ]) {
      globalThis.__aimsProjectPermissions = permissions
      for (const path of ['/projects', '/projects/12']) {
        const before = calls.length
        assert.equal((await fetch(base + path)).status, status, `${path} -> ${status}`)
        assert.equal(calls.length, before, 'no Runtime call without the resource permission')
      }
    }
    globalThis.__aimsProjectPermissions = async () => ({ resources: { projects: ['admin'] } })
    assert.equal((await fetch(`${base}/projects`)).status, 200, 'admin implies view')
    globalThis.__aimsProjectPermissions = async () => ({ resources: { projects: ['view'] } })
    for (const path of ['/projects/0', '/projects/12?search=forged', '/projects/900719925474099312345']) {
      const before = calls.length
      assert.equal((await fetch(base + path)).status, 400)
      assert.equal(calls.length, before)
    }
  } finally {
    if (server) await new Promise(done => server.close(done))
    hooks.deregister()
    globalThis.useRuntimeConfig = oldConfig
    delete globalThis.__aimsProjectSession
    delete globalThis.__aimsProjectTransport
    delete globalThis.__aimsProjectPermissions
  }
})
