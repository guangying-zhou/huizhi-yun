import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createServer } from 'node:http'
import { createApp, createRouter, toNodeListener } from 'h3'

test('project time writes carry their own scoped personnel grant and fixed object binding', async () => {
  const user = { uid: 'U1', tenant: 'T1', deployment: 'host' }
  let denied = false
  const calls = []
  globalThis.__projectCommandPermit = async (_event, actor, target) => {
    assert.deepEqual(actor, user)
    if (denied) throw Object.assign(new Error('denied'), { statusCode: 403 })
    return { ...target, actorUid: actor.uid, tenant: actor.tenant, deployment: actor.deployment, allowed: true,
      expiresAt: Date.now() + 10000, scope: { version: 1, project_codes: ['A'], department_codes: [], department_tree_roots: [], masks: [0, 65535] }, bundleVersion: 'v27', bundleHash: 'hash27', policyRevision: 27 }
  }
  globalThis.__projectCommandCall = async (_event, op, input, options) => {
    calls.push({ op, input, options })
    return { code: 0, data: { id: 7 } }
  }
  const hooks = registerHooks({ resolve(specifier, context, next) {
    if (specifier.endsWith('/projectCommandAuthorization')) return { url: 'data:text/javascript,export const loadProjectCommandAuthorization=(...args)=>globalThis.__projectCommandPermit(...args)', shortCircuit: true }
    if (specifier.endsWith('/enterpriseRuntimeClient')) return { url: 'data:text/javascript,export const requireEnterpriseUser=async()=>({uid:"U1",tenant:"T1",deployment:"host"});export const prepareEnterpriseRuntime=async()=>{};export const enterpriseRuntimePermitExpiresAt=()=>Date.now()+15000;export const callEnterpriseRuntime=(...args)=>globalThis.__projectCommandCall(...args)', shortCircuit: true }
    if (specifier.endsWith('/platformBundleAuthorization')) return { url: 'data:text/javascript,export const loadAuthorizationSnapshotFromConsoleRuntime=async()=>({resources:{timesheet:globalThis.__reviewActions||["submit"]}})', shortCircuit: true }
    if (specifier === './enterpriseAimsPersonnel') return { url: 'data:text/javascript,export const enterpriseAimsPersonnel=async()=>[]', shortCircuit: true }
    if (specifier === './enterpriseAimsTimeEntryReviews') return { url: 'data:text/javascript,export const enterpriseAimsTimeEntryReviewRead=async()=>({})', shortCircuit: true }
    if (specifier === './enterpriseAimsProjects') return { url: 'data:text/javascript,export const enterpriseAimsProjectScope=async()=>({})', shortCircuit: true }
    if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) {
      const candidate = resolve(dirname(fileURLToPath(context.parentURL)), specifier)
      if (!existsSync(candidate) && existsSync(candidate + '.ts')) return { url: pathToFileURL(candidate + '.ts').href, shortCircuit: true }
    }
    return next(specifier, context)
  } })
  let server
  try {
    const d = await import('../server/utils/enterpriseAimsTimesheet.ts')
    const app = createApp()
    const router = createRouter()
    const cases = [
      { handler: d.enterpriseAimsTimesheetWeekSubmit, path: '/weeks/2026-W40:submit', route: '/weeks/:periodKey', resource: 'timesheet', projectId: '', objectId: '', subId: '' },
      { handler: d.enterpriseAimsProjectTimeEntryCreate, path: '/projects/7/time', route: '/projects/:id/time', body: { hours: 0.1 }, resource: 'timesheet', projectId: '7', objectId: '', subId: '' },
      { handler: d.enterpriseAimsProjectTimeEntryUpdate, path: '/projects/7/time/8', route: '/projects/:id/time/:entryId', body: { hours: 0.2 }, resource: 'timesheet', projectId: '7', objectId: '', subId: '8' },
      { handler: d.enterpriseAimsProjectTimeEntryDelete, path: '/projects/7/time/8/delete', route: '/projects/:id/time/:entryId/delete', resource: 'timesheet', projectId: '7', objectId: '', subId: '8' }
    ]
    for (const c of cases) router.post(c.route, c.handler)
    router.post('/projects/:id/reviews', d.enterpriseAimsTimeEntryReviewSubmit)
    app.use(router)
    server = createServer(toNodeListener(app))
    await new Promise(done => server.listen(0, '127.0.0.1', done))
    const request = (c, body = c.body) => fetch(`http://127.0.0.1:${server.address().port}${c.path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'marked-key' }, body: JSON.stringify(body) })
    for (const c of cases) {
      assert.equal((await request(c)).status, 200)
      const last = calls.at(-1)
      assert.equal(last.input.projectWriteAuthorization.projectId, c.projectId)
      assert.equal(last.input.projectWriteAuthorization.workItemId, '')
      assert.equal(last.input.projectWriteAuthorization.resource, c.resource)
      assert.equal(last.input.projectWriteAuthorization.action, 'submit')
      assert.equal(last.input.projectWriteAuthorization.objectId, c.objectId)
      assert.equal(last.input.projectWriteAuthorization.subId, c.subId)
      assert.equal(last.input.projectWriteAuthorization.bundleHash, 'hash27')
      const n = calls.length
      denied = true
      assert.equal((await request(c)).status, 403)
      denied = false
      assert.equal(calls.length, n)
    }
    const review = { path: '/projects/7/reviews' }
    const reviewBody = { action: 'approve', entries: [{ id: 8, rowVersion: 2 }] }
    const beforeReview = calls.length
    assert.equal((await request(review, reviewBody)).status, 403, 'timesheet:submit cannot approve')
    assert.equal(calls.length, beforeReview)
    globalThis.__reviewActions = ['approve']
    assert.equal((await request(review, reviewBody)).status, 200)
    const approved = calls.at(-1)
    assert.equal(approved.op, 'aims.time-entry-review-submit')
    assert.equal(approved.input.projectWriteAuthorization.resource, 'timesheet')
    assert.equal(approved.input.projectWriteAuthorization.action, 'approve')
    assert.deepEqual(approved.input.payload.entries, reviewBody.entries)
    assert.equal(approved.options.idempotencyKey, 'marked-key')
  } finally {
    if (server) await new Promise(done => server.close(done))
    hooks.deregister()
    delete globalThis.__projectCommandPermit
    delete globalThis.__projectCommandCall
    delete globalThis.__reviewActions
  }
})
