import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createApp, createRouter, defineEventHandler, toNodeListener } from 'h3'

test('W1-A project output and release reads gate permits and bind the actor', async () => {
  const root = resolve(import.meta.dirname, '../..')
  const calls = []
  const session = { authenticated: true, tokenUse: 'access', subjectType: 'user', uid: 'person-a', tenant: 'tenant-a', deployment: 'enterprise-test' }
  const oldConfig = globalThis.useRuntimeConfig
  globalThis.useRuntimeConfig = () => ({ public: { appCode: 'enterprise' } })
  globalThis.__w1aSession = session
  globalThis.__w1aAuthorization = async () => ({ resources: { projects: ['view'] } })
  globalThis.__w1aTransport = async (_event, path, options) => {
    calls.push({ path, options })
    if (globalThis.__w1aRuntimeUnavailable) return { handled: false }
    return { handled: true, data: { code: 0, data: path.endsWith('project-releases:list')
      ? { items: [{ id: 9, version_code: 'v1' }] }
      : [{ id: 7, name: '验收文档' }] } }
  }
  const hooks = registerHooks({
    resolve(specifier, context, next) {
      let source
      if (specifier.endsWith('/consoleSessionBridge') || specifier === './consoleSessionBridge') source = 'export const resolveConsoleAuthWithSessionBridge=async()=>globalThis.__w1aSession'
      if (specifier.endsWith('/tenantRuntimeClient') || specifier === './tenantRuntimeClient') source = 'export const maybeCallTenantRuntime=(...args)=>globalThis.__w1aTransport(...args);export const verifiedServiceCommandActor=()=>null;export const prepareTenantRuntime=async()=>true'
      if (specifier.endsWith('/platformBundleAuthorization')) source = 'export const loadAuthorizationSnapshotFromConsoleRuntime=async()=>globalThis.__w1aAuthorization();export const loadScopedAuthorizationFromConsoleRuntime=async()=>({grants:[{permissions:[{appCode:\'aims\',resourceCode:\'projects\',action:\'admin\'}],scopes:[{dimension:\'project\',predicate:\'code\',value:\'PRJ-1\'}]}]})'
      if (specifier.endsWith('/directoryApi')) source = 'export const fetchDirectoryApi=async(path)=>path.includes(\'user-departments\')?{code:0,data:{primaryDeptCode:\'D-1\',departments:[]}}:{code:0,data:{tree:[{deptCode:\'D-1\',name:\'研发\',children:[]}],flat:[{deptCode:\'D-1\',name:\'研发\',managerId:\'person-a\'}]}};export const fetchConsoleDirectoryApi=fetchDirectoryApi'
      if (source) return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true }
      let candidate
      if (specifier.startsWith('~~/')) candidate = resolve(root, 'enterprise', specifier.slice(3))
      else if (specifier.startsWith('@hzy/foundation/')) candidate = resolve(root, 'foundation', specifier.slice('@hzy/foundation/'.length))
      else if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) candidate = resolve(dirname(fileURLToPath(context.parentURL)), specifier)
      if (candidate && !existsSync(candidate) && existsSync(`${candidate}.ts`)) return { url: pathToFileURL(`${candidate}.ts`).href, shortCircuit: true }
      return next(specifier, context)
    }
  })
  let server
  try {
    const app = createApp()
    const router = createRouter()
    app.use(defineEventHandler((event) => {
      event.context.consoleAuth = session
    }))
    router.get('/deliverables', (await import('../server/routes/aims/api/v1/deliverables/index.get.ts')).default)
    router.get('/projects/:id/deliverables/:deliverableId', (await import('../server/routes/aims/api/v1/projects/[id]/deliverables/[deliverableId].get.ts')).default)
    router.get('/projects/:id/releases', (await import('../server/routes/aims/api/v1/projects/[id]/releases.get.ts')).default)
    router.get('/projects/:id/releases/:releaseId', (await import('../server/routes/aims/api/v1/projects/[id]/releases/[releaseId].get.ts')).default)
    router.post('/work-items/:id/deliverables', (await import('../server/routes/aims/api/v1/work-items/[id]/deliverables.post.ts')).default)
    app.use(router)
    server = createServer(toNodeListener(app))
    await new Promise(done => server.listen(0, '127.0.0.1', done))
    const base = `http://127.0.0.1:${server.address().port}`
    const paths = ['/deliverables?project_id=12', '/projects/12/deliverables/7', '/projects/12/releases', '/projects/12/releases/9']

    for (const path of paths) assert.equal((await fetch(base + path)).status, 200, path)
    assert.deepEqual(calls.map(call => call.path), [
      '/v1/enterprise/aims/project-deliverables:list',
      '/v1/enterprise/aims/project-deliverables:list',
      '/v1/enterprise/aims/project-releases:list',
      '/v1/enterprise/aims/project-releases:list'
    ])
    for (const call of calls) {
      assert.equal(call.options.body.authorization.actorUid, session.uid)
      assert.equal(call.options.body.authorization.tenant, session.tenant)
      assert.equal(call.options.body.authorization.deployment, session.deployment)
      assert.equal(call.options.body.authorization.action, 'view')
      assert.equal(call.options.body.query.current_user_project_admin_project_codes, 'PRJ-1')
    }
    assert.deepEqual(calls[1].options.body.query.project_id, '12')
    assert.deepEqual(calls[1].options.body.query.deliverable_id, '7')
    assert.equal(calls[1].options.body.query.page, undefined)
    assert.equal(calls[3].options.body.query.page, undefined)

    for (const [path, page, pageSize] of [
      ['/deliverables?project_id=12&page=2&pageSize=10', '2', '10'],
      ['/projects/12/releases?page=3&pageSize=5', '3', '5']
    ]) {
      assert.equal((await fetch(base + path)).status, 200, path)
      const query = calls.at(-1).options.body.query
      assert.equal(query.page, page)
      assert.equal(query.pageSize, pageSize)
      assert.equal(query.current_user_project_admin_project_codes, 'PRJ-1')
    }
    assert.equal((await fetch(base + '/projects/12/releases?page=2')).status, 200)
    assert.equal(calls.at(-1).options.body.query.page, '2')
    assert.equal(calls.at(-1).options.body.query.pageSize, undefined)

    globalThis.__w1aAuthorization = async () => ({ resources: { projects: ['edit'] } })
    const create = async (path, body) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    for (const [path, body] of [
      ['/work-items/0/deliverables', { name: '成果' }],
      ['/work-items/12/deliverables?actor=forged', { name: '成果' }],
      ['/work-items/12/deliverables', { name: '成果', entityId: 99 }],
      ['/work-items/12/deliverables', { name: '成果', items: [{ entityType: 'target', entityId: 99 }] }]
    ]) {
      const before = calls.length
      assert.equal((await create(path, body)).status, 400)
      assert.equal(calls.length, before)
    }
    assert.equal((await create('/work-items/12/deliverables', { name: '标记成果', deliverableType: 'document', required: true })).status, 200)
    const created = calls.at(-1)
    assert.equal(created.path, '/v1/enterprise/aims/project-deliverables:batch-create')
    assert.equal(created.options.body.authorization.actorUid, session.uid)
    assert.equal(created.options.body.authorization.resource, 'project-deliverables')
    assert.equal(created.options.body.authorization.action, 'edit')
    assert.deepEqual(created.options.body.payload.items, [{
      entityType: 'matter', entityId: 12, name: '标记成果', deliverableType: 'document', required: true,
      description: '', acceptanceCriteria: ''
    }])
    globalThis.__w1aAuthorization = async () => ({ resources: { projects: ['view'] } })
    const beforeDenied = calls.length
    assert.equal((await create('/work-items/12/deliverables', { name: '不允许' })).status, 403)
    assert.equal(calls.length, beforeDenied)

    for (const authorization of [
      async () => ({ resources: {} }),
      async () => ({ resources: { projects: [] } }),
      async () => ({ resources: { work_items: ['view'] } })
    ]) {
      globalThis.__w1aAuthorization = authorization
      for (const path of paths) {
        const before = calls.length
        assert.equal((await fetch(base + path)).status, 403, path)
        assert.equal(calls.length, before, 'no Runtime call without projects:view')
      }
    }
    globalThis.__w1aAuthorization = async () => {
      throw Object.assign(new Error('console unavailable'), { statusCode: 503 })
    }
    for (const path of paths) {
      const before = calls.length
      assert.equal((await fetch(base + path)).status, 503, path)
      assert.equal(calls.length, before)
    }
    globalThis.__w1aAuthorization = async () => ({ resources: { projects: ['view'] } })
    globalThis.__w1aRuntimeUnavailable = true
    for (const path of paths) assert.equal((await fetch(base + path)).status, 503, path)
    globalThis.__w1aRuntimeUnavailable = false
    for (const path of [
      '/deliverables?project_id=12&actor=forged',
      '/deliverables?project_id=12&page=0',
      '/deliverables?project_id=12&page=1.5',
      '/deliverables?project_id=12&page=1&page=2',
      '/deliverables?project_id=12&pageSize=101',
      '/deliverables?project_id=12&page=9007199254740992',
      '/projects/12/releases?page=0',
      '/projects/12/releases?pageSize=101',
      '/projects/12/releases?page=1&page=2',
      '/projects/12/releases?status=published',
      '/projects/0/deliverables/7', '/projects/12/deliverables/0',
      '/projects/12/deliverables/7?tenant=forged',
      '/projects/0/releases', '/projects/12/releases/0',
      '/projects/12/releases/9?actor=forged'
    ]) {
      const before = calls.length
      assert.equal((await fetch(base + path)).status, 400, path)
      assert.equal(calls.length, before)
    }
    for (const path of ['/projects/12/deliverables/8', '/projects/12/releases/10']) {
      assert.equal((await fetch(base + path)).status, 404, path)
    }
  } finally {
    if (server) await new Promise(done => server.close(done))
    hooks.deregister()
    globalThis.useRuntimeConfig = oldConfig
    delete globalThis.__w1aSession
    delete globalThis.__w1aAuthorization
    delete globalThis.__w1aTransport
    delete globalThis.__w1aRuntimeUnavailable
  }
})
