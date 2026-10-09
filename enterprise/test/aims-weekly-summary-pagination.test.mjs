import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createServer } from 'node:http'
import { createApp, defineEventHandler, toNodeListener } from 'h3'

test('weekly summary BFF validates optional pages and keeps current permission/scope before Runtime', async () => {
  const root = resolve(import.meta.dirname, '../..'), calls = []
  let allowed = true
  globalThis.__weeklySummaryRuntime = async (_event, operation, input) => {
    calls.push({ operation, input })
    return { code: 0, data: {} }
  }
  globalThis.__weeklySummarySnapshot = async () => ({ resources: { weekly_reports: allowed ? ['view'] : [] }, actionPolicies: {} })
  const hooks = registerHooks({ resolve(specifier, context, next) {
    if (specifier.endsWith('/enterpriseRuntimeClient'))
      return { url: 'data:text/javascript,export const requireEnterpriseUser=async()=>({uid:"U1",tenant:"T1",deployment:"host"});export const prepareEnterpriseRuntime=async()=>{};export const enterpriseRuntimePermitExpiresAt=()=>Date.now()+14000;export const callEnterpriseRuntime=(...args)=>globalThis.__weeklySummaryRuntime(...args)', shortCircuit: true }
    if (specifier.endsWith('/platformBundleAuthorization'))
      return { url: 'data:text/javascript,export const loadAuthorizationSnapshotFromConsoleRuntime=(...args)=>globalThis.__weeklySummarySnapshot(...args)', shortCircuit: true }
    if (specifier === './enterpriseAimsProjects')
      return { url: 'data:text/javascript,export const enterpriseAimsProjectScope=async()=>({scope_project_codes:"P1"})', shortCircuit: true }
    let candidate
    if (specifier.startsWith('@hzy/foundation/'))
      candidate = resolve(root, 'foundation', specifier.slice('@hzy/foundation/'.length))
    else
      if (specifier.startsWith('.') && context.parentURL?.startsWith('file:'))
        candidate = resolve(dirname(fileURLToPath(context.parentURL)), specifier)
    if (candidate && !existsSync(candidate) && existsSync(candidate + '.ts'))
      return { url: pathToFileURL(candidate + '.ts').href, shortCircuit: true }
    return next(specifier, context)
  } })
  let server
  try {
    const { enterpriseAimsWeeklyReportOverview } = await import('../server/utils/enterpriseAimsWeeklyReportOverview.ts')
    const app = createApp().use(defineEventHandler(enterpriseAimsWeeklyReportOverview))
    server = createServer(toNodeListener(app))
    await new Promise(done => server.listen(0, '127.0.0.1', done))
    const request = q => fetch(`http://127.0.0.1:${server.address().port}/?year=2026&week=1${q}`)
    assert.equal((await request('&page=2&pageSize=100&search=SnapshotManager')).status, 200)
    assert.equal(calls.at(-1).operation, 'aims.weekly-report-overview')
    assert.deepEqual(calls.at(-1).input.query, { page: '2', pageSize: '100', year: '2026', week: '1', search: 'SnapshotManager', scope_project_codes: 'P1' })
    assert.equal(calls.at(-1).input.authorization.actorUid, 'U1')
    assert.equal((await request('')).status, 200)
    assert.equal(calls.at(-1).input.query.page, undefined)
    const count = calls.length
    for (const q of ['&page=0', '&pageSize=101', '&page=1&page=2', '&page=1.0', '&page=', '&uid=other', '&scope_project_codes=ALL'])
      assert.equal((await request(q)).status, 400, q)
    allowed = false
    assert.equal((await request('&page=1')).status, 403)
    assert.equal(calls.length, count)
  } finally {
    if (server)
      await new Promise(done => server.close(done))
    hooks.deregister()
    delete globalThis.__weeklySummaryRuntime
    delete globalThis.__weeklySummarySnapshot
  }
})
