import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createApp, createRouter, defineEventHandler, toNodeListener } from 'h3'

test('Aims weekly-report Host bridge retains actor, tenant and project scope', async () => {
  const root = resolve(import.meta.dirname, '../..')
  const calls = []
  const session = { authenticated: true, tokenUse: 'access', subjectType: 'user', uid: 'person-a', tenant: 'tenant-a', deployment: 'enterprise-test' }
  const oldConfig = globalThis.useRuntimeConfig
  globalThis.useRuntimeConfig = () => ({ public: { appCode: 'enterprise' } })
  globalThis.__aimsWeeklyReportSession = session
  globalThis.__aimsWeeklyReportAllowed = true
  globalThis.__aimsWeeklyReportTransport = async (_event, path, options) => {
    calls.push({ path, options })
    return { handled: true, data: { code: 0, data: path.endsWith(':list') ? { items: [] } : { periodKey: '2026-W37', report: { id: 42 } } } }
  }
  const hooks = registerHooks({
    resolve(specifier, context, next) {
      let source
      if (specifier.endsWith('/consoleSessionBridge') || specifier === './consoleSessionBridge') source = 'export const resolveConsoleAuthWithSessionBridge=async()=>globalThis.__aimsWeeklyReportSession'
      if (specifier.endsWith('/tenantRuntimeClient') || specifier === './tenantRuntimeClient') source = 'export const maybeCallTenantRuntime=(...args)=>globalThis.__aimsWeeklyReportTransport(...args);export const verifiedServiceCommandActor=()=>null;export const prepareTenantRuntime=async()=>true'
      if (specifier.endsWith('/platformBundleAuthorization')) source = "export const loadAuthorizationSnapshotFromConsoleRuntime=async()=>({resources:globalThis.__aimsWeeklyReportAllowed?{weekly_reports:['view']}:{},actionPolicies:{}});export const loadScopedAuthorizationFromConsoleRuntime=async()=>({grants:[{permissions:[{appCode:'aims',resourceCode:'projects',action:'admin'}],scopes:[{dimension:'project',predicate:'code',value:'PRJ-1'}]}]})"
      if (specifier.endsWith('/directoryApi')) source = "export const fetchDirectoryApi=async(path)=>path.includes('user-departments')?{code:0,data:{primaryDeptCode:'D-1',departments:[]}}:{code:0,data:{tree:[{deptCode:'D-1',name:'研发',children:[]}],flat:[{deptCode:'D-1',name:'研发',managerId:'person-a'}]}}"
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
    router.get('/projects/:id/weekly-reports', (await import('../server/routes/aims/api/v1/projects/[id]/weekly-reports/index.get.ts')).default)
    router.get('/projects/:id/weekly-reports/:periodKey', (await import('../server/routes/aims/api/v1/projects/[id]/weekly-reports/[periodKey].get.ts')).default)
    app.use(router)
    server = createServer(toNodeListener(app))
    await new Promise(done => server.listen(0, '127.0.0.1', done))
    const base = `http://127.0.0.1:${server.address().port}`

    globalThis.__aimsWeeklyReportAllowed = false
    assert.equal((await fetch(`${base}/projects/12/weekly-reports`)).status, 403)
    assert.equal(calls.length, 0)
    globalThis.__aimsWeeklyReportAllowed = true

    assert.equal((await fetch(`${base}/projects/12/weekly-reports?year=2026`)).status, 200)
    const list = calls.at(-1)
    assert.equal(list.path, '/v1/enterprise/aims/weekly-reports:list')
    assert.equal(list.options.scope, 'aims:weekly-reports:view')
    assert.equal(list.options.body.tenant, 'tenant-a')
    assert.equal(list.options.body.projectId, '12')
    assert.equal(list.options.body.authorization.actorUid, 'person-a')
    assert.equal(list.options.body.authorization.resource, 'weekly_reports')
    assert.equal(list.options.body.query.current_user_project_admin_project_codes, 'PRJ-1')

    assert.equal((await fetch(`${base}/projects/12/weekly-reports/2026-W37`)).status, 200)
    const detail = calls.at(-1)
    assert.equal(detail.path, '/v1/enterprise/aims/weekly-reports:view')
    assert.equal(detail.options.body.periodKey, '2026-W37')

    for (const path of ['/projects/12/weekly-reports?tenant=tenant-b', '/projects/12/weekly-reports?includeEntries=1', '/projects/0/weekly-reports', '/projects/12/weekly-reports/2026-W1', '/projects/12/weekly-reports/2026-W37?year=2026']) {
      const before = calls.length
      assert.equal((await fetch(base + path)).status, 400)
      assert.equal(calls.length, before)
    }
  } finally {
    if (server) await new Promise(done => server.close(done))
    hooks.deregister()
    globalThis.useRuntimeConfig = oldConfig
    delete globalThis.__aimsWeeklyReportSession
    delete globalThis.__aimsWeeklyReportAllowed
    delete globalThis.__aimsWeeklyReportTransport
  }
})
