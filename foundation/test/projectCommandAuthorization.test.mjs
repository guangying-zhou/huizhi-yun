import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

test('project command projection retains only action grants and fails closed on missing policy facts', async () => {
  const hooks = registerHooks({ resolve(specifier, context, next) {
    if (specifier === './platformBundleAuthorization') return { url: 'data:text/javascript,export const loadScopedAuthorizationFromConsoleRuntime=(...args)=>globalThis.__commandScopeLoad(...args)', shortCircuit: true }
    if (specifier === './enterpriseRuntimeClient') return { url: 'data:text/javascript,export const enterpriseRuntimePermitExpiresAt=()=>Date.now()+15000', shortCircuit: true }
    if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) {
      const candidate = resolve(dirname(fileURLToPath(context.parentURL)), specifier)
      if (!existsSync(candidate) && existsSync(candidate + '.ts')) return { url: pathToFileURL(candidate + '.ts').href, shortCircuit: true }
    }
    return next(specifier, context)
  } })
  try {
    const { loadProjectCommandAuthorization } = await import('../server/utils/projectCommandAuthorization.ts')
    const { foundationProjectProjectionAllows } = await import('../server/utils/projectScopeAuthorization.ts')
    const edit = { grantId: 'edit-A', permissions: [{ appCode: 'aims', resourceCode: 'work_items', action: 'edit' }], scopes: [{ dimension: 'project', predicate: 'code', value: 'A' }] }
    const view = { grantId: 'view-B', permissions: [{ appCode: 'aims', resourceCode: 'projects', action: 'view' }], scopes: [{ dimension: 'project', predicate: 'code', value: 'B' }] }
    let snapshot = { uid: 'U1', appCode: 'aims', grants: [edit, view], bundleVersion: 'v27', bundleHash: 'hash27', policyRevision: 27, authorizationExpiresAt: Date.now() + 12000 }
    globalThis.__commandScopeLoad = async (_event, uid, app, request) => {
      assert.equal(uid, 'U1')
      assert.equal(app, 'aims')
      assert.equal(request.resourceCode, 'work_items')
      assert.equal(request.action, 'edit')
      return snapshot
    }
    const run = () => loadProjectCommandAuthorization({}, { uid: 'U1', tenant: 'T1', deployment: 'host' }, { resource: 'work_items', action: 'edit', projectId: '1', workItemId: '7' })
    const permit = await run()
    assert.equal(permit.projectId, '1')
    assert.equal(permit.workItemId, '7')
    assert.equal(permit.resource, 'work_items')
    assert.ok(permit.expiresAt <= snapshot.authorizationExpiresAt)
    assert.equal(foundationProjectProjectionAllows(permit.scope, { projectCode: 'A', departmentCode: '', departmentTree: [], member: false, owner: false, creator: false, participant: false }), true)
    assert.equal(foundationProjectProjectionAllows(permit.scope, { projectCode: 'B', departmentCode: '', departmentTree: [], member: false, owner: false, creator: false, participant: false }), false)
    const valid = snapshot
    for (const change of [{ bundleHash: '' }, { uid: 'other' }, { policyRevision: undefined }, { authorizationExpiresAt: Date.now() - 1 }]) {
      snapshot = { ...valid, ...change }
      await assert.rejects(run(), { statusCode: 503 })
    }
    snapshot = { ...valid, grants: [view] }
    await assert.rejects(run(), { statusCode: 403 })
    snapshot = { ...valid, grants: [{ ...edit, scopes: [{ dimension: 'unknown', predicate: 'code', value: 'X' }] }] }
    await assert.rejects(run(), { statusCode: 503 })
    snapshot = { ...valid, grants: [{ ...edit, permissions: [{ appCode: 'aims', resourceCode: 'integration_operations', action: 'replay' }] }] }
    globalThis.__commandScopeLoad = async (_event, _uid, _app, request) => {
      assert.deepEqual(request, { resourceCode: 'integration_operations', action: 'replay' })
      return snapshot
    }
    const replay = await loadProjectCommandAuthorization({}, { uid: 'U1', tenant: 'T1', deployment: 'host' }, { resource: 'integration_operations', action: 'replay', projectId: '1', workItemId: '7' })
    assert.equal(replay.action, 'replay')
    assert.equal(foundationProjectProjectionAllows(replay.scope, { projectCode: 'B', departmentCode: '', departmentTree: [], member: false, owner: false, creator: false, participant: false }), false)
    globalThis.__commandScopeLoad = async () => {
      throw Object.assign(new Error('unavailable'), { statusCode: 503 })
    }
    await assert.rejects(run(), { statusCode: 503 })
  } finally {
    hooks.deregister()
    delete globalThis.__commandScopeLoad
  }
})
