import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

test('project write helper preserves scoped static decisions and delegates only live relationships', async () => {
  const hooks = registerHooks({
    resolve(specifier, context, next) {
      if (specifier === './platformBundleAuthorization')
        return { url: 'data:text/javascript,export const loadScopedAuthorizationFromConsoleRuntime=(...args)=>globalThis.__pa03Load(...args)', shortCircuit: true }
      if (specifier === './enterpriseRuntimeClient')
        return { url: 'data:text/javascript,export const enterpriseRuntimePermitExpiresAt=()=>Date.now()+15000', shortCircuit: true }
      if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) {
        const candidate = resolve(dirname(fileURLToPath(context.parentURL)), specifier)
        if (!existsSync(candidate) && existsSync(candidate + '.ts'))
          return { url: pathToFileURL(candidate + '.ts').href, shortCircuit: true }
      }
      return next(specifier, context)
    }
  })
  try {
    const { evaluateFoundationScopedAuthorization } = await import('../server/utils/scopeEvaluator.ts')
    const { loadProjectWriteAuthorization, projectWriteDiscoveryAllows } = await import('../server/utils/projectWriteAuthorization.ts')
    const edit = { grantId: 'edit-A', permissions: [{ appCode: 'aims', resourceCode: 'projects', action: 'edit' }], scopes: [{ dimension: 'project', predicate: 'code', value: 'A' }] }
    const viewB = { grantId: 'view-B', permissions: [{ appCode: 'aims', resourceCode: 'projects', action: 'view' }], scopes: [{ dimension: 'project', predicate: 'code', value: 'B' }] }
    let grants = [viewB, edit]
    globalThis.__pa03Load = async (_event, uid, app, options) => {
      assert.equal(uid, 'U1')
      assert.equal(app, 'aims')
      assert.equal(options.resourceCode, 'projects')
      assert.equal(options.action, 'edit')
      return { decision: evaluateFoundationScopedAuthorization({ grants, required: { appCode: app, resourceCode: options.resourceCode, action: options.action }, object: options.object }) }
    }
    const user = { uid: 'U1', tenant: 'T1', deployment: 'host' }
    const permit = (object, target = { resource: 'projects', action: 'edit' }) => loadProjectWriteAuthorization({}, user, '1', object, target)
    const allowed = await permit({ projectCode: 'A' })
    assert.equal(allowed.allowed, true)
    assert.equal(allowed.mode, 'static-or-project-manager')
    assert.equal(allowed.actorUid, 'U1')
    assert.equal(allowed.projectId, '1')
    assert.ok(allowed.expiresAt > Date.now() && allowed.expiresAt <= Date.now() + 15000)
    // Distinct roles cannot splice edit from A with view scope B.
    assert.equal((await permit({ projectCode: 'B' })).allowed, false)
    grants = [] // withdrawn / expired grants are absent from the verified Console decision
    assert.equal((await permit({ projectCode: 'A' })).allowed, false)
    const conditional = await permit({ projectCode: 'A' }, { resource: 'project-members', action: 'remove' })
    assert.equal(conditional.resource, 'project-members')
    assert.equal(conditional.action, 'remove')
    assert.equal(projectWriteDiscoveryAllows(false, 'manager'), true)
    for (const role of ['member', 'viewer', null, 'admin'])
      assert.equal(projectWriteDiscoveryAllows(false, role), false)
    assert.equal(projectWriteDiscoveryAllows(true, null), true)
    globalThis.__pa03Load = async () => ({ grants: [] })
    await assert.rejects(permit({ projectCode: 'A' }), { statusCode: 503 })
    globalThis.__pa03Load = async () => {
      throw Object.assign(new Error('dependency unavailable'), { statusCode: 503 })
    }
    await assert.rejects(permit({ projectCode: 'A' }), { statusCode: 503 })
  } finally {
    hooks.deregister()
    delete globalThis.__pa03Load
  }
})
