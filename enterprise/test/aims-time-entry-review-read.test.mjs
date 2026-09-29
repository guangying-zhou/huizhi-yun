import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createServer } from 'node:http'
import { createApp, createRouter, defineEventHandler, toNodeListener } from 'h3'

test('review read gets current approve/submit paired scope and refuses browser flags, dependency failures and grant mixing', async () => {
  const root = resolve(import.meta.dirname, '../..')
  const calls = []
  let actions = ['submit'], mode = 'valid'
  const scopedCalls = []
  globalThis.__reviewSnapshot = async () => {
    if (mode === 'dependency') throw Object.assign(new Error('Console unavailable'), { statusCode: 503 })
    return { resources: { timesheet: actions }, actionPolicies: {} }
  }
  globalThis.__reviewScoped = async (_event, uid, app, requested) => {
    scopedCalls.push(requested.action)
    const action = requested.action
    const grant = (action, project) => ({ permissions: [{ appCode: 'aims', resourceCode: 'timesheet', action }], scopes: [{ dimension: 'project', predicate: 'code', value: project }] })
    return { uid: mode === 'wrong-uid' ? 'other' : uid, appCode: app, bundleVersion: 'v1', bundleHash: mode === 'revision-drift' ? action : 'hash', policyRevision: 3, authorizationExpiresAt: Date.now() + (mode === 'expired' ? -1 : 5000),
      grants: mode === 'mismatched-action' ? [grant('view', 'A')] : mode === 'mixing' ? [grant(action, 'A'), grant(action === 'approve' ? 'submit' : 'approve', 'B')] : [grant(action, 'A')] }
  }
  globalThis.__reviewRuntime = async (_event, operation, input) => {
    calls.push({ operation, input })
    return { code: 0, data: { periodKey: input.query.periodKey, items: [], total: 0, page: 1, pageSize: 20, statusCounts: { submitted: 0, approved: 0, returned: 0 } } }
  }
  const hooks = registerHooks({ resolve(specifier, context, next) {
    if (specifier.endsWith('/enterpriseRuntimeClient')) return { url: 'data:text/javascript,export const requireEnterpriseUser=async()=>({uid:"U1",tenant:"T1",deployment:"host"});export const prepareEnterpriseRuntime=async()=>{};export const enterpriseRuntimePermitExpiresAt=()=>Date.now()+14000;export const callEnterpriseRuntime=(...args)=>globalThis.__reviewRuntime(...args)', shortCircuit: true }
    if (specifier.endsWith('/platformBundleAuthorization')) return { url: 'data:text/javascript,export const loadAuthorizationSnapshotFromConsoleRuntime=(...args)=>globalThis.__reviewSnapshot(...args);export const loadScopedAuthorizationFromConsoleRuntime=(...args)=>globalThis.__reviewScoped(...args)', shortCircuit: true }
    let candidate
    if (specifier.startsWith('@hzy/foundation/')) candidate = resolve(root, 'foundation', specifier.slice('@hzy/foundation/'.length))
    else if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) candidate = resolve(dirname(fileURLToPath(context.parentURL)), specifier)
    if (candidate && !existsSync(candidate) && existsSync(candidate + '.ts')) return { url: pathToFileURL(candidate + '.ts').href, shortCircuit: true }
    return next(specifier, context)
  } })
  let server
  try {
    const { enterpriseAimsTimeEntryReviewRead } = await import('../server/utils/enterpriseAimsTimeEntryReviews.ts')
    const { foundationProjectProjectionAllows } = await import('../../foundation/server/utils/projectScopeAuthorization.ts')
    const app = createApp(), router = createRouter()
    router.get('/projects/:id/reviews', defineEventHandler(enterpriseAimsTimeEntryReviewRead))
    app.use(router)
    server = createServer(toNodeListener(app))
    await new Promise(done => server.listen(0, '127.0.0.1', done))
    const request = query => fetch(`http://127.0.0.1:${server.address().port}/projects/12/reviews?${query}`)
    for (const allowed of [['submit'], ['approve'], ['approve', 'submit']]) {
      actions = allowed
      const before = Date.now()
      assert.equal((await request('periodKey=2026-W39&page=1&pageSize=20')).status, 200)
      const permit = calls.at(-1).input.authorization
      assert.deepEqual(permit.branches.map(branch => branch.action), allowed)
      assert.equal(permit.actorUid, 'U1')
      assert.equal(permit.projectId, '12')
      assert.equal(permit.resource, 'time-entry-reviews')
      assert.equal(permit.query.periodKey, '2026-W39')
      assert.ok(permit.expiresAt > before && permit.expiresAt <= before + 5500)
      assert.equal(calls.at(-1).operation, 'aims.time-entry-review-list')
    }
    mode = 'mixing'
    actions = ['approve']
    assert.equal((await request('periodKey=2026-W39')).status, 200)
    const projection = calls.at(-1).input.authorization.branches[0].scope
    const facts = { projectCode: 'B', departmentCode: '', departmentTree: [], member: true, owner: true, creator: true, participant: true }
    assert.equal(foundationProjectProjectionAllows(projection, facts), false)
    assert.equal(foundationProjectProjectionAllows(projection, { ...facts, projectCode: 'A' }), true)
    const count = calls.length
    for (const query of ['periodKey=2021-W53', 'periodKey=2026-W39&pageSize=101', 'periodKey=2026-W39&page=1&page=2', 'periodKey=2026-W39&current_user_can_approve_timesheet=1', 'periodKey=2026-W39&current_user_can_review_assigned_timesheet=1', 'periodKey=2026-W39&uid=other', 'period_key=2026-W39', 'periodKey=2026-W39&status=submitted', 'periodKey=2026-W39&cycleCode=x']) assert.equal((await request(query)).status, 400, query)
    mode = 'valid'
    actions = ['view', 'edit', 'admin']
    assert.equal((await request('periodKey=2026-W39')).status, 403)
    actions = ['approve']
    mode = 'mismatched-action'
    assert.equal((await request('periodKey=2026-W39')).status, 403)
    for (const failure of ['dependency', 'expired', 'wrong-uid']) {
      mode = failure
      assert.equal((await request('periodKey=2026-W39')).status, 503)
    }
    actions = ['approve', 'submit']
    mode = 'revision-drift'
    assert.equal((await request('periodKey=2026-W39')).status, 503)
    assert.equal(calls.length, count)
    assert.ok(scopedCalls.includes('approve') && scopedCalls.includes('submit'))
  } finally {
    if (server) await new Promise(done => server.close(done))
    hooks.deregister()
    delete globalThis.__reviewSnapshot
    delete globalThis.__reviewScoped
    delete globalThis.__reviewRuntime
  }
})
