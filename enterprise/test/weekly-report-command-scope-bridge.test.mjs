import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createServer } from 'node:http'
import { createApp, createRouter, toNodeListener } from 'h3'

test('weekly draft and submit bind reports:edit scope to the owning project', async () => {
  let denied = false
  const calls = []
  globalThis.__weeklyCommandPermit = async (_event, actor, target) => {
    assert.equal(actor.uid, 'U1')
    assert.deepEqual(target, { resource: 'reports', action: 'edit', projectId: '7', workItemId: '' })
    if (denied) throw Object.assign(new Error('denied'), { statusCode: 403 })
    return { ...target, actorUid: 'U1', tenant: 'T1', deployment: 'host', allowed: true,
      expiresAt: Date.now() + 10000, scope: { version: 1, project_codes: ['P7'], masks: [0, 65535] },
      bundleVersion: 'v27', bundleHash: 'hash27', policyRevision: 27 }
  }
  globalThis.__weeklyCommandCall = async (_event, operation, input) => {
    calls.push({ operation, input })
    return { code: 0, data: { id: 7 } }
  }
  const hooks = registerHooks({ resolve(specifier, context, next) {
    if (specifier.endsWith('/projectCommandAuthorization')) return { url: 'data:text/javascript,export const loadProjectCommandAuthorization=(...args)=>globalThis.__weeklyCommandPermit(...args)', shortCircuit: true }
    if (specifier.endsWith('/enterpriseRuntimeClient')) return { url: 'data:text/javascript,export const requireEnterpriseUser=async()=>({uid:"U1",tenant:"T1",deployment:"host"});export const prepareEnterpriseRuntime=async()=>{};export const enterpriseRuntimePermitExpiresAt=()=>Date.now()+15000;export const callEnterpriseRuntime=(...args)=>globalThis.__weeklyCommandCall(...args)', shortCircuit: true }
    if (specifier.endsWith('/platformBundleAuthorization')) return { url: 'data:text/javascript,export const loadAuthorizationSnapshotFromConsoleRuntime=async()=>({resources:{reports:["edit"],weekly_reports:globalThis.__weeklyCanSubmit?["submit"]:[]}})', shortCircuit: true }
    if (specifier === './enterpriseAimsProjects') return { url: 'data:text/javascript,export const enterpriseAimsProjectScope=async()=>({})', shortCircuit: true }
    if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) {
      const candidate = resolve(dirname(fileURLToPath(context.parentURL)), specifier)
      if (!existsSync(candidate) && existsSync(candidate + '.ts')) return { url: pathToFileURL(candidate + '.ts').href, shortCircuit: true }
    }
    return next(specifier, context)
  } })
  let server
  try {
    globalThis.__weeklyCanSubmit = true
    const { enterpriseAimsProjectWeeklyReportDraft, enterpriseAimsProjectWeeklyReportSubmit } = await import('../server/utils/enterpriseAimsWeeklyGovernance.ts')
    const router = createRouter()
    router.put('/projects/:id/weekly-reports/:periodKey/draft', enterpriseAimsProjectWeeklyReportDraft)
    router.post('/projects/:id/weekly-reports/:periodKey/submit', enterpriseAimsProjectWeeklyReportSubmit)
    const app = createApp()
    app.use(router)
    server = createServer(toNodeListener(app))
    await new Promise(done => server.listen(0, '127.0.0.1', done))
    const base = `http://127.0.0.1:${server.address().port}/projects/7/weekly-reports/2026-W37`
    for (const [method, suffix, operation] of [['PUT', '/draft', 'aims.project-weekly-report-save-draft'], ['POST', '/submit', 'aims.project-weekly-report-submit']]) {
      const request = () => fetch(base + suffix, { method, headers: { 'Content-Type': 'application/json' }, body: '{}' })
      assert.equal((await request()).status, 200)
      const last = calls.at(-1)
      assert.equal(last.operation, operation)
      assert.equal(last.input.projectId, '7')
      assert.equal(last.input.projectWriteAuthorization.resource, 'reports')
      assert.equal(last.input.projectWriteAuthorization.objectId, '')
      assert.equal(last.input.projectWriteAuthorization.subId, '')
      assert.equal(last.input.projectWriteAuthorization.bundleHash, 'hash27')
      assert.equal(last.input.weeklyReportSubmitAuthorization.actorUid, 'U1')
      assert.equal(last.input.weeklyReportSubmitAuthorization.projectId, '7')
      const before = calls.length
      denied = true
      assert.equal((await request()).status, 403)
      denied = false
      assert.equal(calls.length, before)
      globalThis.__weeklyCanSubmit = false
      assert.equal((await request()).status, 403)
      assert.equal(calls.length, before)
      globalThis.__weeklyCanSubmit = true
    }
  } finally {
    if (server) await new Promise(done => server.close(done))
    hooks.deregister()
    delete globalThis.__weeklyCommandPermit
    delete globalThis.__weeklyCommandCall
    delete globalThis.__weeklyCanSubmit
  }
})
