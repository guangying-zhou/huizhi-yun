import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createServer } from 'node:http'
import { createApp, createRouter, toNodeListener } from 'h3'

test('milestone writes carry their own scoped personnel grant and fixed object binding', async () => {
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
    if (specifier.endsWith('/platformBundleAuthorization')) return { url: 'data:text/javascript,export const loadAuthorizationSnapshotFromConsoleRuntime=async()=>({resources:{projects:["edit"],work_items:["edit"]}})', shortCircuit: true }
    if (specifier === './enterpriseAimsPersonnel') return { url: 'data:text/javascript,export const enterpriseAimsPersonnel=async()=>[]', shortCircuit: true }
    if (specifier === './enterpriseAimsProjects') return { url: 'data:text/javascript,export const enterpriseAimsProjectScope=async()=>({})', shortCircuit: true }
    if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) {
      const candidate = resolve(dirname(fileURLToPath(context.parentURL)), specifier)
      if (!existsSync(candidate) && existsSync(candidate + '.ts')) return { url: pathToFileURL(candidate + '.ts').href, shortCircuit: true }
    }
    return next(specifier, context)
  } })
  let server
  try {
    const d = await import('../server/utils/enterpriseAimsMilestones.ts')
    const app = createApp()
    const router = createRouter()
    const cases = [
      { handler: d.enterpriseAimsProjectMilestoneCreate, path: '/projects/7/milestones', route: '/projects/:id/milestones', body: { name: 'Marked' }, resource: 'projects', projectId: '7', objectId: '', subId: '' },
      { handler: d.enterpriseAimsMilestoneUpdate, path: '/milestones/8', route: '/milestones/:id', body: { description: 'Marked' }, resource: 'projects', projectId: '', objectId: '8', subId: '' },
      { handler: d.enterpriseAimsMilestoneDelete, path: '/milestones/8/delete', route: '/milestones/:id/delete', resource: 'projects', projectId: '', objectId: '8', subId: '' }
    ]
    for (const c of cases) router.post(c.route, c.handler)
    app.use(router)
    server = createServer(toNodeListener(app))
    await new Promise(done => server.listen(0, '127.0.0.1', done))
    const request = (c, body = c.body, key = 'marked-key') => fetch(`http://127.0.0.1:${server.address().port}${c.path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) }, body: JSON.stringify(body) })
    for (const c of cases.slice(0, 2)) {
      for (const field of ['status', 'completed', 'isCompleted', 'completedAt', 'closedAt', 'completionLockRequestId']) {
        const before = calls.length
        const response = await request(c, { name: 'Denied', [field]: field === 'status' ? 'completed' : true })
        assert.equal(response.status, 400, `${c.path} ${field}`)
        assert.equal((await response.json()).data.code, 'milestone_completion_workflow_required')
        assert.equal(calls.length, before, `${c.path} ${field} must not reach Runtime`)
      }
    }
    for (const c of cases) {
      const before = calls.length
      assert.equal((await request(c, c.body, '')).status, 400)
      assert.equal(calls.length, before)
    }
    for (const key of ['startDate', 'start_date', 'endDate', 'end_date']) {
      const n = calls.length
      const response = await request(cases[1], { [key]: '  ' })
      assert.equal(response.status, 400)
      assert.equal((await response.json()).data.code, 'invalid_milestone_date')
      assert.equal(calls.length, n)
    }
    const beforePeriodic = calls.length
    const periodic = await request(cases[0], { name: '手工周期', mode: 'periodic' })
    assert.equal(periodic.status, 400)
    assert.match(JSON.stringify(await periodic.json()), /周期里程碑只能通过模板创建/)
    assert.equal(calls.length, beforePeriodic)
    assert.equal((await request(cases[0], { name: '一次性', mode: 'rolling_plan' })).status, 200)
    assert.equal(calls.length, beforePeriodic + 1)
    assert.equal((await request(cases[1], { endDate: null })).status, 200)
    for (const c of cases) {
      assert.equal((await request(c)).status, 200)
      const last = calls.at(-1)
      assert.equal(last.input.projectWriteAuthorization.projectId, c.projectId)
      assert.equal(last.input.projectWriteAuthorization.workItemId, '')
      assert.equal(last.input.projectWriteAuthorization.resource, c.resource)
      assert.equal(last.input.projectWriteAuthorization.action, 'edit')
      assert.equal(last.input.projectWriteAuthorization.objectId, c.objectId)
      assert.equal(last.input.projectWriteAuthorization.subId, c.subId)
      assert.equal(last.input.projectWriteAuthorization.bundleHash, 'hash27')
      assert.equal(last.options.idempotencyKey, 'marked-key')
      const n = calls.length
      denied = true
      assert.equal((await request(c)).status, 403)
      denied = false
      assert.equal(calls.length, n)
    }
  } finally {
    if (server) await new Promise(done => server.close(done))
    hooks.deregister()
    delete globalThis.__projectCommandPermit
    delete globalThis.__projectCommandCall
  }
})
