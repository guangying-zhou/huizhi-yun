import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

test('accessible Host gates personnel before native Runtime and passes no ACL facts or UUIDs', async () => {
  const deps = {
    user: async () => ({ uid: 'signed-user', tenant: 'C000001', deployment: 'C000001-test-enterprise' }),
    snapshot: async () => ({ resources: {} }), scoped: async () => ({ decision: { allowed: true } }), scope: async () => ({ query: {}, authorization: { hasViewPermission: true, scope: { version: 1, masks: [65535] }, bundleVersion: 'v27', bundleHash: 'hash', policyRevision: 27, expiresAt: Date.now() + 14000 } }), object: async () => ({ projectId: 257 }),
    prepare: async () => {}, call: async (_e, op, body) => op === 'aims.project-view' ? (assert.equal(body.authorization.scope.version, 1), assert.equal(body.authorization.bundleVersion, 'v27'), assert.equal(body.authorization.policyRevision, 27), { code: 0, data: { id: 257, project_code: 'P257', created_by: 'signed-user', leader_uid: null, dept_code: null, members: [] } }) : ({ op, body })
  }
  const hooks = registerHooks({ resolve(s, c, next) {
    const code = s === 'h3'
      ? 'export const createError=o=>Object.assign(new Error(o.message),o);export const getQuery=e=>e.query;export const setHeader=()=>{}'
      : s.endsWith('/enterpriseRuntimeClient')
        ? 'export const requireEnterpriseUser=(...a)=>globalThis.__accessibleDeps.user(...a);export const enterpriseRuntimePermitExpiresAt=()=>Date.now()+14000;export const prepareEnterpriseRuntime=(...a)=>globalThis.__accessibleDeps.prepare(...a);export const callEnterpriseRuntime=(...a)=>globalThis.__accessibleDeps.call(...a)'
        : s.endsWith('/platformBundleAuthorization')
          ? 'export const loadScopedAuthorizationFromConsoleRuntime=(...a)=>globalThis.__accessibleDeps.scoped(...a);export const loadAuthorizationSnapshotFromConsoleRuntime=(...a)=>globalThis.__accessibleDeps.snapshot(...a)'
          : s.endsWith('/authorizationActions')
            ? 'export const authorizationResourcesAllow=()=>globalThis.__accessibleDeps.allowed!==false'
            : s.endsWith('/aimsScopedAuthorization')
              ? 'export const resolveAimsProjectAuthorizationObject=(...a)=>globalThis.__accessibleDeps.object(...a)'
              : s.endsWith('/enterpriseAimsProjects') ? 'export const enterpriseAimsNestedProjectReadPermit=(...a)=>globalThis.__accessibleDeps.scope(...a)' : null
    if (s.endsWith('/aims/layer/server/index')) return { shortCircuit: true, url: 'data:text/javascript,' + encodeURIComponent(`export {readHostAccessibleProjectDocuments} from '${pathToFileURL(resolve(import.meta.dirname, '../../aims/layer/server/internal/projectDocumentAccessible.ts')).href}'`) }
    if (code) return { shortCircuit: true, url: 'data:text/javascript,' + encodeURIComponent(code) }
    if (s.startsWith('.') && c.parentURL?.startsWith('file:')) {
      const candidate = resolve(dirname(fileURLToPath(c.parentURL)), s)
      if (!existsSync(candidate) && existsSync(`${candidate}.ts`)) return { shortCircuit: true, url: pathToFileURL(`${candidate}.ts`).href }
    }
    return next(s, c)
  } })
  globalThis.__accessibleDeps = deps
  try {
    const { enterpriseAimsAccessibleProjectDocuments: run } = await import('../server/utils/enterpriseAimsAccessibleDocuments.ts')
    const result = await run({ query: { projectId: '257' } })
    assert.equal(result.op, 'aims.project-document-accessible-list')
    assert.deepEqual(Object.keys(result.body).sort(), ['authorization', 'deployment', 'projectId', 'tenant'])
    assert.equal(result.body.authorization.actorUid, 'signed-user')
    assert.equal(result.body.authorization.resource, 'projects')
    assert.equal(result.body.authorization.action, 'view')
    assert.equal(result.body.authorization.projectAdmin, true)
    deps.scoped = async (_e, _u, _a, opts) => {
      assert.equal(opts.object.projectId, 257)
      return { decision: { allowed: opts.action === 'view' } }
    }
    assert.equal((await run({ query: { projectId: '257' } })).body.authorization.projectAdmin, false)
    let calls = 0
    deps.prepare = async () => {
      calls++
    }
    for (const query of [{ projectId: '257', actor: 'forged' }, { projectId: '257', projectAdmin: true }, { projectId: ['257'] }, { projectId: '257', project_id: '258' }, { projectId: '0' }]) {
      await assert.rejects(run({ query }), { statusCode: 400 })
    }
    assert.equal(calls, 0)
    deps.allowed = false
    deps.scoped = async () => ({ decision: { allowed: false } })
    await assert.rejects(run({ query: { projectId: '257' } }), { statusCode: 403 })
    assert.equal(calls, 0)
    deps.allowed = true
    deps.snapshot = async () => {
      throw Object.assign(new Error('dependency unavailable'), { statusCode: 503 })
    }
    await assert.rejects(run({ query: { projectId: '257' } }), { statusCode: 503 })
    assert.equal(calls, 0)
  } finally {
    hooks.deregister()
    delete globalThis.__accessibleDeps
  }
})
