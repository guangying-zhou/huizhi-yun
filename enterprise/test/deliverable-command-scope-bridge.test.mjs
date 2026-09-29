import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createServer } from 'node:http'
import { createApp, createRouter, toNodeListener } from 'h3'

test('deliverable writes carry their own scoped personnel grant and fixed object binding', async () => {
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
    if (op === 'aims.project-gitlab-sync-context') return { code: 0, data: { repos: [{ id: 9, repoProjectCode: 'git/group' }] } }
    return { code: 0, data: { id: 7 } }
  }
  const hooks = registerHooks({ resolve(specifier, context, next) {
    if (specifier.endsWith('/projectCommandAuthorization')) return { url: 'data:text/javascript,export const loadProjectCommandAuthorization=(...args)=>globalThis.__projectCommandPermit(...args)', shortCircuit: true }
    if (specifier.endsWith('/enterpriseRuntimeClient')) return { url: 'data:text/javascript,export const requireEnterpriseUser=async()=>({uid:"U1",tenant:"T1",deployment:"host"});export const prepareEnterpriseRuntime=async()=>{};export const enterpriseRuntimePermitExpiresAt=()=>Date.now()+15000;export const callEnterpriseRuntime=(...args)=>globalThis.__projectCommandCall(...args)', shortCircuit: true }
    if (specifier.endsWith('/platformBundleAuthorization')) return { url: 'data:text/javascript,export const loadAuthorizationSnapshotFromConsoleRuntime=async()=>({resources:globalThis.__workItemResourceSnapshot??{projects:["edit"],work_items:["edit"],timesheet:["submit"]}})', shortCircuit: true }
    if (specifier.endsWith('/gitIntegration')) return { url: 'data:text/javascript,export const listGitCommits=async()=>[{sha:"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",message:"marked"}];export const getGitCommitDiff=async()=>[]', shortCircuit: true }
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
    const d = await import('../server/utils/enterpriseAimsDeliverables.ts')
    const w = await import('../server/utils/enterpriseAimsWorkItemWorkspace.ts')
    const p = await import('../server/utils/enterpriseAimsProjectWorkspace.ts')
    const g = await import('../server/utils/enterpriseAimsGitlab.ts')
    const app = createApp()
    const router = createRouter()
    const cases = [
      { handler: d.enterpriseAimsDeliverableUpdate, path: '/deliverables/7', route: '/deliverables/:id', body: { description: 'Marked' }, resource: 'projects', objectId: '7', subId: '' },
      { handler: d.enterpriseAimsDeliverableDelete, path: '/deliverables/7/delete', route: '/deliverables/:id/delete', resource: 'projects', objectId: '7', subId: '' },
      { handler: d.enterpriseAimsDeliverableBatchCreate, path: '/deliverables/batch', route: '/deliverables/batch', body: { items: [{ entityType: 'matter', entityId: 7, name: 'Marked' }] }, resource: 'projects', objectId: '', subId: '' },
      { handler: w.enterpriseAimsWorkItemDeliverableUpdate, path: '/work-items/7/deliverables/8', route: '/work-items/:id/deliverables/:deliverableId', body: { evidenceNote: 'Marked' }, resource: 'work_items', objectId: '7', subId: '8' },
      { handler: w.enterpriseAimsWorkItemDecomposeSubmit, path: '/work-items/7/decompose-submit', route: '/work-items/:id/decompose-submit', body: { mode: 'flat', items: [] }, resource: 'work_items', objectId: '7', subId: '' },
      { handler: w.enterpriseAimsWorkItemCloneFromTemplate, path: '/work-items/7/clone-from-template', route: '/work-items/:id/clone-from-template', body: {}, resource: 'work_items', objectId: '7', subId: '' },
      { handler: w.enterpriseAimsWorkItemDocumentLink, path: '/work-items/7/documents', route: '/work-items/:id/documents', body: { documentId: '11111111-1111-4111-8111-111111111111' }, resource: 'work_items', objectId: '7', subId: '' },
      { handler: w.enterpriseAimsWorkItemDocumentUnlink, path: '/work-items/7/documents/11111111-1111-4111-8111-111111111111', route: '/work-items/:id/documents/:documentId', method: 'DELETE', resource: 'work_items', objectId: '7', subId: '11111111-1111-4111-8111-111111111111' },
      { handler: w.enterpriseAimsWorkItemCommentCreate, path: '/work-items/7/comments', route: '/work-items/:id/comments', body: { content: 'marked' }, resource: 'work_items', objectId: '7', subId: '' },
      { handler: w.enterpriseAimsWorkItemCommitLink, path: '/work-items/7/commits', route: '/work-items/:id/commits', body: { commitId: 8 }, resource: 'work_items', objectId: '7', subId: '' },
      { handler: w.enterpriseAimsWorkItemCommitUnlink, path: '/work-items/7/commits/8', route: '/work-items/:id/commits/:commitId', method: 'DELETE', resource: 'work_items', objectId: '7', subId: '8' },
      { handler: w.enterpriseAimsWorkItemTimeEntryCreate, path: '/work-items/7/time-entries', route: '/work-items/:id/time-entries', body: { entryDate: '2026-09-27', hours: 0.1 }, resource: 'timesheet', objectId: '7', subId: '' },
      { handler: w.enterpriseAimsWorkItemTimeEntryUpdate, path: '/work-items/7/time-entries/8', route: '/work-items/:id/time-entries/:entryId', method: 'PATCH', body: { hours: 0.2 }, resource: 'timesheet', objectId: '7', subId: '8' },
      { handler: w.enterpriseAimsWorkItemTimeEntryDelete, path: '/work-items/7/time-entries/8', route: '/work-items/:id/time-entries/:entryId', method: 'DELETE', resource: 'timesheet', objectId: '7', subId: '8' },
      { handler: w.enterpriseAimsWorkItemBatchUpdate, path: '/work-items/batch', route: '/work-items/batch', method: 'PATCH', body: { ids: [7], changes: { priority: 'P1' } }, resource: 'work_items', objectId: '', subId: '' }
    ]
    for (const c of cases) router[(c.method || 'POST').toLowerCase()](c.route, c.handler)
    router.post('/projects/:id/repos', p.enterpriseAimsProjectRepoLink)
    router.delete('/projects/:id/repos', p.enterpriseAimsProjectRepoUnlink)
    router.post('/projects/:id/sync-gitlab', g.enterpriseAimsProjectSyncGitlab)
    router.delete('/work-items/:id/documents', w.enterpriseAimsWorkItemDocumentUnlinkCurrent)
    app.use(router)
    server = createServer(toNodeListener(app))
    await new Promise(done => server.listen(0, '127.0.0.1', done))
    const request = (c, body = c.body) => fetch(`http://127.0.0.1:${server.address().port}${c.path}`, { method: c.method || 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'marked-key' }, body: JSON.stringify(body) })
    for (const c of cases) {
      assert.equal((await request(c)).status, 200)
      const last = calls.at(-1)
      assert.equal(last.input.projectWriteAuthorization.projectId, '')
      assert.equal(last.input.projectWriteAuthorization.workItemId, '')
      assert.equal(last.input.projectWriteAuthorization.resource, c.resource)
      assert.equal(last.input.projectWriteAuthorization.action, c.resource === 'timesheet' ? 'submit' : 'edit')
      assert.equal(last.input.projectWriteAuthorization.objectId, c.objectId)
      assert.equal(last.input.projectWriteAuthorization.subId, c.subId)
      assert.equal(last.input.projectWriteAuthorization.bundleHash, 'hash27')
      if (c.resource === 'timesheet' || c.path.includes('/comments') || c.path.includes('/commits') || c.path.includes('/documents') || c.path.includes('/decompose-submit') || c.path.includes('/clone-from-template') || c.path === '/work-items/batch') {
        assert.equal(last.options.idempotencyKey, 'marked-key')
        const beforeInvalidKey = calls.length
        assert.equal((await fetch(`http://127.0.0.1:${server.address().port}${c.path}`, { method: c.method || 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(c.body) })).status, 400)
        assert.equal(calls.length, beforeInvalidKey)
      }
      const n = calls.length
      denied = true
      assert.equal((await request(c)).status, 403)
      denied = false
      assert.equal(calls.length, n)
      if (c.resource === 'timesheet') {
        globalThis.__workItemResourceSnapshot = { work_items: ['edit'] }
        assert.equal((await request(c)).status, 403)
        assert.equal(calls.length, n)
        delete globalThis.__workItemResourceSnapshot
      }
    }
    for (const c of [
      { path: '/projects/7/repos', body: { repoProjectCode: 'git/group' }, method: 'POST' },
      { path: '/projects/7/repos?repoProjectCode=git%2Fgroup', method: 'DELETE' }
    ]) {
      assert.equal((await request(c)).status, 200)
      const last = calls.at(-1)
      assert.equal(last.input.projectWriteAuthorization.resource, 'projects')
      assert.equal(last.input.projectWriteAuthorization.projectId, '7')
      assert.equal(last.input.projectWriteAuthorization.objectId, '')
      assert.equal(last.options.idempotencyKey, 'marked-key')
      const beforeMissingKey = calls.length
      assert.equal((await fetch(`http://127.0.0.1:${server.address().port}${c.path}`, {
        method: c.method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(c.body)
      })).status, 400)
      assert.equal(calls.length, beforeMissingKey)
      const n = calls.length
      denied = true
      assert.equal((await request(c)).status, 403)
      denied = false
      assert.equal(calls.length, n)
    }
    const sync = { path: '/projects/7/sync-gitlab', method: 'POST', body: {} }
    assert.equal((await request(sync)).status, 200)
    const firstIngest = calls.at(-1)
    assert.equal(firstIngest.op, 'aims.project-gitlab-commit-ingest')
    assert.equal(firstIngest.input.projectWriteAuthorization.projectId, '7')
    assert.equal(firstIngest.input.projectWriteAuthorization.resource, 'work_items')
    assert.equal((await request(sync)).status, 200)
    assert.equal(calls.at(-1).options.idempotencyKey, firstIngest.options.idempotencyKey)
    const beforeDeniedSync = calls.length
    globalThis.__workItemResourceSnapshot = { work_items: ['view'] }
    assert.equal((await request(sync)).status, 403)
    delete globalThis.__workItemResourceSnapshot
    assert.equal(calls.length, beforeDeniedSync, 'sync must not contact Runtime or GitLab without edit permission')
    const prior = calls.length
    assert.equal((await fetch(`http://127.0.0.1:${server.address().port}/work-items/7/documents`, { method: 'DELETE' })).status, 400)
    assert.equal(calls.length, prior, 'collection DELETE must not reach Runtime')
    assert.equal((await fetch(`http://127.0.0.1:${server.address().port}/work-items/7/documents/not-a-uuid`, { method: 'DELETE' })).status, 400)
    assert.equal(calls.length, prior, 'invalid document ID must not reach Runtime')
  } finally {
    if (server) await new Promise(done => server.close(done))
    hooks.deregister()
    delete globalThis.__projectCommandPermit
    delete globalThis.__projectCommandCall
    delete globalThis.__workItemResourceSnapshot
  }
})
