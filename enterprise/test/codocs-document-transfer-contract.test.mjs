import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createApp, createRouter, toNodeListener } from 'h3'

test('Codocs document transfer routes enforce identity, scope, runtime contracts, and failure semantics', async () => {
  const root = resolve(import.meta.dirname, '../..')
  const session = { authenticated: true, tokenUse: 'access', subjectType: 'user', uid: 'person-a', tenant: 'tenant-a', deployment: 'enterprise-test' }
  const state = {
    session,
    authorization: { resources: { documents: ['edit'] }, actionPolicies: {} },
    departments: { departments: [{ deptCode: 'dept-a', name: '研发部', managerId: 'manager-a', leaderId: 'leader-a' }], primaryDeptCode: 'dept-primary' },
    department: { managerId: 'manager-a', leaderId: 'leader-a' },
    projects: { managed: [{ projectCode: 'project-a', name: '项目 A' }], joined: [{ projectCode: 'project-joined', name: '参与项目' }] },
    metadata: { success: true, data: { uuid: 'doc-1', title: '设计稿', owner_uid: 'person-a', doc_type: 'private', oss_path: 'codocs/person/doc-1.md' } },
    runtimeResponse: { success: true, data: { shareId: 42 } },
    runtimeCalls: [],
    preparations: [],
    notifications: [],
    ossMode: 'ok',
    notifyMode: 'ok'
  }
  const oldDefineEventHandler = globalThis.defineEventHandler
  const oldSession = globalThis.__codocsTransferSession
  const oldState = globalThis.__codocsTransferState
  globalThis.defineEventHandler = handler => handler
  globalThis.__codocsTransferSession = session
  globalThis.__codocsTransferState = state

  const hooks = registerHooks({
    resolve(specifier, context, next) {
      let source
      if (specifier.endsWith('/enterpriseRuntimeClient')) source = `
        export const requireEnterpriseUser = async () => globalThis.__codocsTransferSession.authenticated ? globalThis.__codocsTransferSession : (() => { const e = new Error('未登录'); e.statusCode = 401; throw e })()
        export const enterpriseRuntimePermitExpiresAt = () => Date.now() + 10000
        export const prepareEnterpriseRuntime = async (_event, operation) => { globalThis.__codocsTransferState.preparations.push(operation); return true }
        export const callEnterpriseRuntime = async (_event, operation, body, options = {}) => { const s = globalThis.__codocsTransferState; s.runtimeCalls.push({ operation, body, options }); if (operation === 'codocs.personal-document-view') return s.metadata; if (s.runtimeMode === 'throw') { const e = new Error('runtime failure'); e.statusCode = 503; throw e } if (operation === 'console.directory-self-departments') return { data: s.departments }; if (operation === 'console.directory-self-projects') return { data: s.projects }; return s.runtimeResponse }
      `
      if (specifier.endsWith('/platformBundleAuthorization')) source = 'export const loadAuthorizationSnapshotFromConsoleRuntime = async () => globalThis.__codocsTransferState.authorization'
      if (specifier.endsWith('/authorizationActions')) source = 'export const authorizationResourcesAllow = (resources, resource, action) => Array.isArray(resources?.[resource]) && resources[resource].includes(action)'
      if (specifier.endsWith('/notify')) source = 'export const sendNotification = async payload => { const s = globalThis.__codocsTransferState; s.notifications.push(payload); if (s.notifyMode === \'throw\') throw new Error(\'notify failure\') }'
      if (specifier.endsWith('/oss')) source = `
        export const createRuntimeOSSClient = async () => {
          const s = globalThis.__codocsTransferState
          if (s.ossMode === 'throw') throw new Error('oss client failure')
          return { get: async path => { if (s.ossMode === 'get-throw') throw new Error('oss get failure'); return { content: Buffer.from(path.endsWith('.yjs') ? 'snapshot' : 'markdown') } }, head: async () => ({ meta: { 'content-type': 'text/markdown' } }), delete: async () => {} }
        }
        export const createRuntimeProjectsOSSClient = async () => ({ put: async (path, content, options) => { if (globalThis.__codocsTransferState.ossMode === 'put-throw') throw new Error('oss put failure'); if (!options.forbidOverwrite) throw new Error('overwrite allowed'); (globalThis.__codocsTransferState.puts ||= []).push({ path, content: Buffer.from(content).toString() }) }, get: async () => ({ content: Buffer.from('markdown') }) })
      `
      if (specifier.endsWith('/enterpriseCodocsSnapshot')) source = `
        export const readSnapshotHead = async () => globalThis.__codocsTransferState.snapshotHead
        export const readSnapshotMarkdown = async () => 'published v2 markdown'
      `
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
    router.post('/documents/:uuid/dept-shares', (await import('../server/routes/codocs/api/documents/[uuid]/dept-shares.post.ts')).default)
    router.post('/documents/:uuid/project-transfer', (await import('../server/routes/codocs/api/documents/[uuid]/project-transfer.post.ts')).default)
    app.use(router)
    server = createServer(toNodeListener(app))
    await new Promise(done => server.listen(0, '127.0.0.1', done))
    const base = `http://127.0.0.1:${server.address().port}`
    const request = (path, body, key = 'transfer-key-1', headers = {}) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key, ...headers }, body: JSON.stringify(body) })

    // Authentication and request-shape validation happen before any Runtime call.
    state.session.authenticated = false
    assert.equal((await request('/documents/doc-1/dept-shares', { deptCode: 'dept-a' })).status, 401)
    state.session.authenticated = true
    const beforeInvalid = state.runtimeCalls.length
    assert.equal((await request('/documents/doc-1/dept-shares?unexpected=1', { deptCode: 'dept-a' })).status, 400)
    assert.equal((await request('/documents/doc-1/dept-shares', { deptCode: 'dept-a', actorUid: 'attacker' })).status, 400)
    assert.equal((await request('/documents/doc-1/dept-shares', { deptCode: 'dept-a' }, 'short')).status, 400)
    assert.equal(state.runtimeCalls.length, beforeInvalid)

    // Department membership, capability, and fixed Runtime contract.
    state.authorization = { resources: { documents: ['view'] }, actionPolicies: {} }
    assert.equal((await request('/documents/doc-1/dept-shares', { deptCode: 'dept-a' })).status, 403)
    state.authorization = { resources: { documents: ['edit'] }, actionPolicies: {} }
    state.departments = { departments: [], primaryDeptCode: 'other-dept' }
    assert.equal((await request('/documents/doc-1/dept-shares', { deptCode: 'dept-a' })).status, 403)
    state.departments = { departments: [{ deptCode: 'dept-a', managerId: 'manager-a', leaderId: 'leader-a' }], primaryDeptCode: 'other-dept' }
    const deptKey = 'department-transfer-key'
    const dept = await request('/documents/doc-1/dept-shares', { deptCode: 'dept-a', departmentName: '研发部', message: '请接收' }, deptKey)
    assert.equal(dept.status, 200)
    const deptCall = state.runtimeCalls.at(-1)
    assert.equal(deptCall.operation, 'codocs.document-transfer-department')
    assert.equal(deptCall.options.idempotencyKey, deptKey)
    assert.deepEqual(deptCall.body.payload, { dept_code: 'dept-a', message: '请接收' })
    assert.equal(deptCall.body.authorization.actorUid, 'person-a')
    assert.equal(deptCall.body.authorization.resource, 'document-transfer')
    assert.equal(deptCall.body.authorization.action, 'department')
    assert.ok(deptCall.body.authorization.expiresAt > Date.now())
    assert.deepEqual(state.notifications.at(-1).touser, ['manager-a', 'leader-a'])
    assert.equal(state.notifications.at(-1).sourceAppCode, 'enterprise')
    assert.equal(state.notifications.at(-1).metadata.moduleAppCode, 'codocs')
    assert.equal(state.notifications.at(-1).metadata.notificationKind, 'business_event')
    assert.equal(state.notifications.at(-1).metadata.actionableState, undefined)
    assert.equal(state.notifications.at(-1).url, '/codocs/departments')
    assert.equal((await request('/documents/doc-1/dept-shares', { deptCode: 'dept-a', message: '请接收' }, deptKey)).status, 200)
    assert.equal(state.runtimeCalls.at(-1).options.idempotencyKey, deptKey)

    // Notification failure means the Runtime write is retained and caller gets retryable 503.
    state.notifyMode = 'throw'
    assert.equal((await request('/documents/doc-1/dept-shares', { deptCode: 'dept-a' }, 'notify-failure-key')).status, 503)
    assert.deepEqual(state.runtimeCalls.findLast(call => call.operation === 'codocs.document-transfer-department').body.payload, { dept_code: 'dept-a' })
    state.notifyMode = 'ok'

    // Project membership accepts managed/joined projects and forwards the OSS move contract.
    state.projects = { managed: [], joined: [] }
    assert.equal((await request('/documents/doc-1/project-transfer', { projectCode: 'project-a' })).status, 403)
    state.projects = { managed: [{ projectCode: 'project-a', name: '项目 A' }], joined: [] }
    const projectKey = 'project-transfer-key'
    const project = await request('/documents/doc-1/project-transfer', { projectCode: 'project-a', projectName: '项目 A' }, projectKey)
    assert.equal(project.status, 200)
    const projectCall = state.runtimeCalls.at(-1)
    assert.equal(projectCall.operation, 'codocs.document-transfer-project')
    assert.equal(projectCall.options.idempotencyKey, projectKey)
    assert.deepEqual(projectCall.body.payload, { project_code: 'project-a', source_oss_path: 'codocs/person/doc-1.md', new_oss_path: 'codocs/projects/project-a/docs/设计稿.md' })
    assert.equal(projectCall.body.authorization.action, 'project')
    // The Runtime view action accepts no Host-only flags such as skip_content.
    assert.deepEqual(state.runtimeCalls.findLast(call => call.operation === 'codocs.personal-document-view').body.query, {})
    assert.equal(projectCall.body.authorization.resource, 'document-transfer')

    // Storage and Runtime failures retain their documented 503 semantics.
    state.ossMode = 'get-throw'
    assert.equal((await request('/documents/doc-1/project-transfer', { projectCode: 'project-a' }, 'oss-failure-key')).status, 503)
    state.ossMode = 'ok'
    state.runtimeMode = 'throw'
    assert.equal((await request('/documents/doc-1/project-transfer', { projectCode: 'project-a' }, 'runtime-failure-key')).status, 503)
    state.runtimeMode = 'ok'

    // A v2 document moves its exact published snapshot, never the derived copy
    // at oss_path and never the stale .yjs beside it.
    const originalFlag = process.env.HZY_ENTERPRISE_CODOCS_SNAPSHOT_V2
    process.env.HZY_ENTERPRISE_CODOCS_SNAPSHOT_V2 = 'true'
    try {
      state.snapshotHead = { generation: 2, epoch: 0 }
      state.puts = []
      assert.equal((await request('/documents/doc-1/project-transfer', { projectCode: 'project-a' }, 'v2-transfer-key')).status, 200)
      assert.deepEqual(state.puts, [{ path: 'codocs/projects/project-a/docs/设计稿.md', content: 'published v2 markdown' }])
      // A private document never saved with v2 keeps the original copy, .yjs included.
      state.snapshotHead = { generation: 0, epoch: 0 }
      state.puts = []
      assert.equal((await request('/documents/doc-1/project-transfer', { projectCode: 'project-a' }, 'v1-transfer-key')).status, 200)
      assert.deepEqual(state.puts.map(put => put.content), ['markdown', 'snapshot'])
    } finally {
      if (originalFlag === undefined) delete process.env.HZY_ENTERPRISE_CODOCS_SNAPSHOT_V2
      else process.env.HZY_ENTERPRISE_CODOCS_SNAPSHOT_V2 = originalFlag
    }
  } finally {
    if (server) await new Promise(done => server.close(done))
    hooks.deregister()
    globalThis.defineEventHandler = oldDefineEventHandler
    globalThis.__codocsTransferSession = oldSession
    globalThis.__codocsTransferState = oldState
  }
})
