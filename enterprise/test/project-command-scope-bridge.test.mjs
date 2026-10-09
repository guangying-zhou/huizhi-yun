import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createServer } from 'node:http'
import { createApp, createRouter, toNodeListener } from 'h3'

test('work item writes including tree actions send action-bound scope and reject client facts before Runtime', async () => {
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
    if (specifier.endsWith('/platformBundleAuthorization')) return { url: 'data:text/javascript,export const loadScopedAuthorizationFromConsoleRuntime=async()=>{throw Error("must use scoped command helper")}', shortCircuit: true }
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
    const { enterpriseAimsWorkItemWrite } = await import('../server/utils/enterpriseAimsWorkItemWrite.ts')
    const app = createApp()
    const router = createRouter()
    const cases = [
      { action: 'create', path: '/projects/1/work-items', route: '/projects/:id/work-items', body: { title: 'Marked' } },
      { action: 'edit', path: '/work-items/7', route: '/work-items/:id', body: { projectId: '1', title: 'Marked', expectedVersion: 'a'.repeat(64) } },
      { action: 'associate', path: '/work-items/7/association', route: '/work-items/:id/association', body: { projectId: '1', versionId: 5, expectedVersion: 'a'.repeat(64) } }
    ]
    for (const action of ['plan-ready', 'start', 'reset', 'reopen', 'complete', 'matter-complete', 'completion-replay']) cases.push({ action, path: `/work-items/7/${action}`, route: `/work-items/:id/${action}`, body: { projectId: '1', ...(action === 'completion-replay' ? { expectedOperationVersion: 3, reason: 'Marked recovery' } : { expectedVersion: 'a'.repeat(64) }) } })
    for (const action of ['confirm-distribute', 'revoke-distribute', 'confirm-append', 'reject-append', 'append-tasks', 'breakdown']) cases.push({ action, path: `/work-items/7/${action}`, route: `/work-items/:id/${action}`, body: { projectId: '1', expectedVersion: 'a'.repeat(64), ...(['append-tasks', 'breakdown'].includes(action) ? { subtasks: [] } : {}) } })
    for (const c of cases) router.post(c.route, event => enterpriseAimsWorkItemWrite(event, c.action))
    app.use(router)
    server = createServer(toNodeListener(app))
    await new Promise(done => server.listen(0, '127.0.0.1', done))
    const request = (c, body = c.body) => fetch(`http://127.0.0.1:${server.address().port}${c.path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'marked-key' }, body: JSON.stringify(body) })
    for (const c of cases) {
      assert.equal((await request(c)).status, 200)
      const last = calls.at(-1)
      assert.equal(last.input.authorization.projectId, '1')
      assert.equal(last.input.authorization.workItemId, c.action === 'create' ? '' : '7')
      assert.equal(last.input.authorization.resource, c.action === 'completion-replay' ? 'integration_operations' : 'work_items')
      assert.equal(last.input.authorization.action, c.action === 'create' ? 'create' : c.action === 'completion-replay' ? 'replay' : ['confirm-distribute', 'confirm-append', 'reject-append'].includes(c.action) ? 'confirm' : 'edit')
      assert.equal(last.input.authorization.bundleHash, 'hash27')
      const n = calls.length
      assert.equal((await request(c, { ...c.body, scope: { masks: [65535] } })).status, 400)
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
