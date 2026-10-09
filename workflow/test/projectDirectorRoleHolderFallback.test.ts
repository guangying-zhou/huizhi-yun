import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import test from 'node:test'

// Execute the actual resolver and middleware with local dependency doubles.
// No HTTP, credentials, DB or listening ports are used.
function harness(role: Record<string, unknown>, dependencyStatus?: number) {
  const calls: Array<{ path: string, query: Record<string, unknown> }> = []
  const resolver = readFileSync(new URL('../server/utils/projectDirectorRoleHolder.ts', import.meta.url), 'utf8')
  const middleware = readFileSync(new URL('../server/middleware/data-runtime.ts', import.meta.url), 'utf8')
  const source = `${resolver}\n${middleware}`
    .replace(/import[\s\S]*?from\s+['"][^'"]+['"]\s*/g, '')
    .replace('export default defineEventHandler', 'const handler = defineEventHandler')
    .replace(/export /g, '')
  const js = stripTypeScriptTypes(source)
  const dependencies = {
    createError: (failure: { statusCode: number, message: string }) => Object.assign(new Error(failure.message), failure),
    defineEventHandler: (handler: unknown) => handler,
    getQuery: (event: { query: unknown }) => event.query,
    getRequestURL: (event: { path: string }) => new URL(`https://example.test/api/v1${event.path}`),
    readBody: async () => ({ comment: 'reason' }),
    ensureWorkflowConsoleAuth: async () => ({ authenticated: true, tokenUse: 'user' }),
    getTrustedWorkflowProxyActor: () => null,
    getRequestUid: () => 'ordinary-user',
    requirePermission: async () => {},
    resolveWorkflowRoutePermission: () => ({ resource: 'workflow_tasks', action: 'view' }),
    resolveWorkflowProxyAuthorizationPurpose: () => 'workflow_tasks:view',
    checkSubjectEligibility: async () => ({ allowed: true }),
    collectWorkflowInitiatorContext: async () => ({}),
    getDirectoryUserByUid: async () => ({}),
    requestServiceAccessToken: async () => 'local-test-token',
    resolveServiceAppBaseUrl: () => 'https://console.example.test',
    trustedServiceRequestHeaders: () => ({}),
    fetchConsoleServiceJson: async () => {
      if (dependencyStatus) throw Object.assign(new Error('dependency'), { statusCode: dependencyStatus })
      return { code: 0, data: { roles: [role] } }
    },
    maybeCallWorkflowDataRuntime: async (_event: unknown, path: string, options: { query: Record<string, unknown> }) => {
      calls.push({ path, query: options.query })
      // The Runtime suite verifies SQL filtering and its transactional role guard.
      if (path.endsWith('/director/approve') && !options.query.current_project_director_uid) {
        throw Object.assign(new Error('role_holder_missing'), { statusCode: 409 })
      }
      return { handled: true, data: { code: 0, data: { items: [{ task_id: 'ordinary' }] }, effects: {} } }
    },
    runWorkflowRuntimeEffects: async () => ({})
  }
  const factory = new Function(...Object.keys(dependencies), `${js}\nreturn handler`)
  const handler = factory(...Object.values(dependencies))
  return { calls, request: (path: string, method = 'GET', query = {}) => handler({ path, query, node: { req: { method } } }) }
}
const missing = { roleCode: 'project_director', status: 'missing', errorCode: 'role_holder_missing', holders: [] }

test('missing/unresolved director degrades all read families and strips forged facts', async () => {
  for (const status of ['missing', 'unresolved']) {
    for (const path of ['/tasks/pending', '/tasks/ordinary', '/instances/12', '/instances/by-biz', '/instances/by-biz-history']) {
      const h = harness({ ...missing, status, errorCode: `role_holder_${status}` })
      const response = await h.request(path, 'GET', {
        app_code: 'aims', resource_code: 'milestones', action_code: 'milestone_completion',
        current_project_director_uid: 'forged', currentProjectDirectorUid: 'forged',
        current_project_director_revision: '999', currentProjectDirectorRevision: '999',
        current_project_director_display_name: 'forged', currentProjectDirectorDisplayName: 'forged'
      })
      assert.equal(response.code, 0)
      assert.deepEqual(response.data.items, [{ task_id: 'ordinary' }])
      assert.equal(Object.keys(h.calls[0]!.query).some(key => /director/i.test(key)), false)
    }
  }
})
test('missing director preserves ordinary writes; director writes remain 409', async () => {
  const h = harness(missing)
  assert.equal((await h.request('/tasks/ordinary/approve', 'POST')).code, 0)
  await assert.rejects(h.request('/tasks/director/approve', 'POST'), { statusCode: 409, message: 'role_holder_missing' })
})
test('ambiguous roles never degrade or select the first holder', async () => {
  const h = harness({ ...missing, status: 'ambiguous', holders: [{ uid: 'a' }, { uid: 'b' }] })
  await assert.rejects(h.request('/tasks/pending'), { statusCode: 409, message: 'role_holder_ambiguous' })
  assert.equal(h.calls.length, 0)
})
test('Console dependency failure and invalid resolved revision remain 503', async () => {
  for (const h of [harness(missing, 503), harness({ roleCode: 'project_director', status: 'resolved', revision: 0, holders: [{ uid: 'director' }] })]) {
    await assert.rejects(h.request('/tasks/pending'), { statusCode: 503 })
    assert.equal(h.calls.length, 0)
  }
})
test('resolved role injects only verified facts', async () => {
  const h = harness({ roleCode: 'project_director', status: 'resolved', revision: 3, holders: [{ uid: 'director', displayName: '总监' }] })
  await h.request('/tasks/pending')
  assert.equal(h.calls[0]!.query.current_project_director_uid, 'director')
  assert.equal(h.calls[0]!.query.current_project_director_revision, '3')
})
