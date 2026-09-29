import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createApp, createRouter, defineEventHandler, toNodeListener } from 'h3'

test('Aims time-entry Host bridge retains actor, tenant and project scope', async () => {
  const root = resolve(import.meta.dirname, '../..')
  const calls = []
  const session = { authenticated: true, tokenUse: 'access', subjectType: 'user', uid: 'person-a', tenant: 'tenant-a', deployment: 'enterprise-test' }
  const oldConfig = globalThis.useRuntimeConfig
  globalThis.useRuntimeConfig = () => ({ public: { appCode: 'enterprise' } })
  globalThis.__aimsTimeEntrySession = session
  globalThis.__aimsTimeEntryAllowed = true
  globalThis.__aimsTimeEntryTransport = async (_event, path, options) => {
    calls.push({ path, options })
    return { handled: true, data: { code: 0, data: path.endsWith(':list') ? { items: [] } : { id: 42, entryDate: '2026-09-14' } } }
  }
  const hooks = registerHooks({
    resolve(specifier, context, next) {
      let source
      if (specifier.endsWith('/projectCommandAuthorization')) source = 'export const loadProjectCommandAuthorization=async(_event,user,target)=>({...target,actorUid:user.uid,tenant:user.tenant,deployment:user.deployment,allowed:true,expiresAt:Date.now()+10000,scope:{version:1,masks:[65535]},bundleVersion:"v27",bundleHash:"hash27",policyRevision:27})'
      if (specifier.endsWith('/consoleSessionBridge') || specifier === './consoleSessionBridge') source = 'export const resolveConsoleAuthWithSessionBridge=async()=>globalThis.__aimsTimeEntrySession'
      if (specifier.endsWith('/tenantRuntimeClient') || specifier === './tenantRuntimeClient') source = 'export const maybeCallTenantRuntime=(...args)=>globalThis.__aimsTimeEntryTransport(...args);export const verifiedServiceCommandActor=()=>null;export const prepareTenantRuntime=async()=>true'
      if (specifier.endsWith('/platformBundleAuthorization')) source = 'export const loadAuthorizationSnapshotFromConsoleRuntime=async()=>({resources:globalThis.__aimsTimeEntryAllowed?{timesheet:globalThis.__aimsTimeEntryActions||[\'view\']}:{},actionPolicies:{}});export const loadScopedAuthorizationFromConsoleRuntime=async()=>({grants:[{permissions:[{appCode:\'aims\',resourceCode:\'projects\',action:\'admin\'}],scopes:[{dimension:\'project\',predicate:\'code\',value:\'PRJ-1\'}]}]})'
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
    router.get('/projects/:id/time-entries', (await import('../server/routes/aims/api/v1/projects/[id]/time-entries/index.get.ts')).default)
    router.post('/projects/:id/time-entries', (await import('../server/routes/aims/api/v1/projects/[id]/time-entries.post.ts')).default)
    router.patch('/projects/:id/time-entries/:entryId', (await import('../server/routes/aims/api/v1/projects/[id]/time-entries/[entryId].patch.ts')).default)
    router.delete('/projects/:id/time-entries/:entryId', (await import('../server/routes/aims/api/v1/projects/[id]/time-entries/[entryId].delete.ts')).default)
    router.get('/projects/:id/time-entries/:entryId', (await import('../server/routes/aims/api/v1/projects/[id]/time-entries/[entryId].get.ts')).default)
    router.post('/projects/:id/time-entry-reviews', (await import('../server/routes/aims/api/v1/projects/[id]/time-entry-reviews.post.ts')).default)
    router.get('/users/:uid/time-entries', (await import('../server/routes/aims/api/v1/users/[uid]/time-entries.get.ts')).default)
    app.use(router)
    server = createServer(toNodeListener(app))
    await new Promise(done => server.listen(0, '127.0.0.1', done))
    const base = `http://127.0.0.1:${server.address().port}`

    // The review write lane requires explicit approve; edit/view/submit do not
    // authorize it even though the underlying service operation is shared.
    for (const actions of [['edit'], ['view'], ['submit'], []]) {
      globalThis.__aimsTimeEntryAllowed = actions.length > 0
      globalThis.__aimsTimeEntryActions = actions
      const before = calls.length
      const response = await fetch(`${base}/projects/12/time-entry-reviews`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'review-42' }, body: JSON.stringify({ action: 'approve', entries: [{ id: 42, rowVersion: 2 }] }) })
      assert.equal(response.status, 403)
      assert.equal(calls.length, before)
    }
    globalThis.__aimsTimeEntryAllowed = true
    globalThis.__aimsTimeEntryActions = ['approve']
    assert.equal((await fetch(`${base}/projects/12/time-entry-reviews`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'review-42' }, body: JSON.stringify({ action: 'approve', entries: [{ id: 42, rowVersion: 2 }] }) })).status, 200)
    assert.equal(calls.at(-1).options.body.projectWriteAuthorization.action, 'approve')
    assert.deepEqual(calls.at(-1).options.body.payload.entries, [{ id: 42, rowVersion: 2 }])
    delete globalThis.__aimsTimeEntryActions
    globalThis.__aimsTimeEntryAllowed = false
    assert.equal((await fetch(`${base}/projects/12/time-entries`)).status, 403)
    assert.equal(calls.length, 1)
    globalThis.__aimsTimeEntryAllowed = true

    globalThis.__aimsTimeEntryActions = ['submit', 'view']
    const write = (method, path, key, body) => fetch(base + path, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(key ? { 'Idempotency-Key': key } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) })
    for (const actions of [[], ['view'], ['edit'], ['approve'], ['admin']]) {
      globalThis.__aimsTimeEntryActions = actions
      const before = calls.length
      assert.equal((await write('POST', '/projects/12/time-entries', 'denied-intent', { entryDate: '2026-09-14', hours: 1 })).status, 403)
      assert.equal(calls.length, before)
    }
    globalThis.__aimsTimeEntryActions = ['submit', 'view']
    const beforeKey = calls.length
    assert.equal((await write('POST', '/projects/12/time-entries', '', { entryDate: '2026-09-14', hours: 1 })).status, 400)
    assert.equal((await write('POST', '/projects/12/time-entries', 'bad key', { entryDate: '2026-09-14', hours: 1 })).status, 400)
    assert.equal(calls.length, beforeKey)
    for (const [method, path, body, operation] of [
      ['POST', '/projects/12/time-entries', { entryDate: '2026-09-14', hours: 1 }, 'project-time-entries:create'],
      ['PATCH', '/projects/12/time-entries/42', { hours: 2 }, 'project-time-entries:update'],
      ['DELETE', '/projects/12/time-entries/42', null, 'project-time-entries:delete']
    ]) {
      assert.equal((await write(method, path, 'time-intent-42', body)).status, 200)
      const call = calls.at(-1)
      assert.ok(call.path.endsWith(operation))
      assert.equal(call.options.scope, 'aims:enterprise-host:execute')
      assert.equal(call.options.idempotencyKey, 'time-intent-42')
      assert.equal(call.options.body.authorization.actorUid, session.uid)
    }
    delete globalThis.__aimsTimeEntryActions

    assert.equal((await fetch(`${base}/projects/12/time-entries?startDate=2026-09-01&uid=person-b`)).status, 200)
    const list = calls.at(-1)
    assert.equal(list.path, '/v1/enterprise/aims/time-entries:list')
    assert.equal(list.options.scope, 'aims:enterprise-host:execute')
    assert.equal(list.options.body.tenant, 'tenant-a')
    assert.equal(list.options.body.projectId, '12')
    assert.equal(list.options.body.authorization.actorUid, 'person-a')
    assert.equal(list.options.body.authorization.resource, 'timesheet')
    assert.equal(list.options.body.query.current_user_project_admin_project_codes, 'PRJ-1')

    assert.equal((await fetch(`${base}/projects/12/time-entries?page=2&pageSize=100&startDate=2026-08-31&endDate=2026-10-04&monthStart=2026-09-01&monthEnd=2026-09-30&todayDate=2026-09-27&weekStart=2026-09-21&weekEnd=2026-09-27`)).status, 200)
    const paged = calls.at(-1).options.body.query
    assert.equal(paged.page, '2')
    assert.equal(paged.pageSize, '100')
    assert.equal(paged.monthStart, '2026-09-01')
    assert.equal(paged.weekEnd, '2026-09-27')
    assert.equal((await fetch(`${base}/projects/12/time-entries?page=1&pageSize=1&includeUidHours=1`)).status, 200)
    assert.equal(calls.at(-1).options.body.query.includeUidHours, '1')
    globalThis.__aimsTimeEntryAllowed = false
    const deniedCount = calls.length
    assert.equal((await fetch(`${base}/projects/12/time-entries?page=1&includeUidHours=1`)).status, 403)
    assert.equal(calls.length, deniedCount)
    globalThis.__aimsTimeEntryAllowed = true
    for (const query of ['includeUidHours=1', 'page=1&includeUidHours=0', 'page=1&includeUidHours=1&includeUidHours=1', 'pageSize=101', 'page=01', 'page=1&page=2', 'page=1&startDate=2026-02-30', 'page=1&monthStart=2026-09-01&monthEnd=2026-10-01', 'page=1&weekStart=2026-09-21&weekEnd=2026-10-04', 'page=1&current_user_can_approve_timesheet=1', 'page=1&periodKey=2026-W39', 'todayDate=2026-09-27']) {
      const before = calls.length
      assert.equal((await fetch(`${base}/projects/12/time-entries?${query}`)).status, 400, query)
      assert.equal(calls.length, before)
    }

    assert.equal((await fetch(`${base}/projects/12/time-entries/42`)).status, 200)
    const detail = calls.at(-1)
    assert.equal(detail.path, '/v1/enterprise/aims/time-entries:view')
    assert.equal(detail.options.body.projectId, '12')
    assert.equal(detail.options.body.timeEntryId, '42')
    assert.equal(detail.options.body.authorization.tenant, 'tenant-a')

    assert.equal((await fetch(`${base}/users/person-a/time-entries?page=1&pageSize=20&projectId=12&monthStart=2026-09-01&monthEnd=2026-09-30`)).status, 200)
    assert.equal(calls.at(-1).path, '/v1/enterprise/aims/user-time-entries:list')
    assert.equal(calls.at(-1).options.body.code, 'person-a')
    assert.equal(calls.at(-1).options.body.query.projectId, '12')
    assert.equal(calls.at(-1).options.body.authorization.actorUid, 'person-a')
    for (const query of ['pageSize=101', 'page=1&page=2', 'page=1&current_user_can_review_assigned_timesheet=1', 'page=1&monthStart=2026-09-01', 'page=1&calendarProjectId=01']) {
      const before = calls.length
      assert.equal((await fetch(`${base}/users/person-a/time-entries?${query}`)).status, 400)
      assert.equal(calls.length, before)
    }

    // 本人工时清单：manifest 的 member/dev 只有 timesheet:submit，填报页必须能读回
    // 本人记录；他人 uid 无论持有 view/submit/admin 都在签发许可前 403。
    const selfPath = `${base}/users/person-a/time-entries?page=1&pageSize=20`
    for (const actions of [['submit'], ['view'], ['edit'], ['admin']]) {
      globalThis.__aimsTimeEntryActions = actions
      const before = calls.length
      assert.equal((await fetch(selfPath)).status, 200, actions.join(','))
      assert.equal(calls.length, before + 1)
      assert.equal(calls.at(-1).options.body.code, 'person-a')
      assert.equal(calls.at(-1).options.body.authorization.actorUid, 'person-a')
      assert.equal(calls.at(-1).options.body.authorization.action, 'view')
      const other = await fetch(`${base}/users/person-b/time-entries?page=1&pageSize=20`)
      assert.equal(other.status, 403)
      assert.equal(calls.length, before + 1)
    }
    for (const actions of [['approve'], []]) {
      globalThis.__aimsTimeEntryActions = actions
      const before = calls.length
      assert.equal((await fetch(selfPath)).status, 403, actions.join(','))
      assert.equal(calls.length, before)
    }
    // submit 只放行本人清单，不蕴含项目工时读取。
    globalThis.__aimsTimeEntryActions = ['submit']
    const beforeProject = calls.length
    assert.equal((await fetch(`${base}/projects/12/time-entries`)).status, 403)
    assert.equal(calls.length, beforeProject)
    globalThis.__aimsTimeEntryActions = ['submit', 'view']

    for (const path of [
      '/projects/12/time-entries?tenant=tenant-b',
      '/projects/12/time-entries?current_user=person-b',
      '/projects/0/time-entries',
      '/projects/12/time-entries/0',
      '/projects/12/time-entries/42?uid=person-b'
    ]) {
      const before = calls.length
      assert.equal((await fetch(base + path)).status, 400)
      assert.equal(calls.length, before)
    }
  } finally {
    if (server) await new Promise(done => server.close(done))
    hooks.deregister()
    globalThis.useRuntimeConfig = oldConfig
    delete globalThis.__aimsTimeEntrySession
    delete globalThis.__aimsTimeEntryActions
    delete globalThis.__aimsTimeEntryAllowed
    delete globalThis.__aimsTimeEntryTransport
  }
})
