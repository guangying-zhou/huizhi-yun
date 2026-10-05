import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

test('project tab management compiles edit/admin with its own scopes and rejects expired or incomplete snapshots', async () => {
  const hooks = registerHooks({ resolve(specifier, context, next) {
    if (specifier === './platformBundleAuthorization') return { url: 'data:text/javascript,export const loadScopedAuthorizationFromConsoleRuntime=(...args)=>globalThis.__tabLoad(...args)', shortCircuit: true }
    if (specifier === './enterpriseRuntimeClient') return { url: 'data:text/javascript,export const enterpriseRuntimePermitExpiresAt=()=>Date.now()+15000', shortCircuit: true }
    if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) {
      const path = resolve(dirname(fileURLToPath(context.parentURL)), specifier)
      if (!existsSync(path) && existsSync(path + '.ts')) return { url: pathToFileURL(path + '.ts').href, shortCircuit: true }
    }
    return next(specifier, context)
  } })
  try {
    const { loadProjectTabAuthorization } = await import('../server/utils/projectTabAuthorization.ts')
    let grants = [], override = {}
    globalThis.__tabLoad = async (_e, uid, app, options) => {
      assert.equal(options.resourceCode, 'projects')
      assert.equal(options.action, 'edit')
      return { uid, appCode: app, grants, bundleVersion: 'v1', bundleHash: 'hash', policyRevision: 1, authorizationExpiresAt: Date.now() + 14000, ...override }
    }
    const grant = (action, value) => ({ permissions: [{ appCode: 'aims', resourceCode: 'projects', action }], scopes: [{ dimension: 'project', predicate: 'code', value }] })
    for (const action of ['edit', 'admin']) {
      grants = [grant(action, 'A'), grant('view', 'B')]
      const result = await loadProjectTabAuthorization({}, 'reader')
      assert.deepEqual(result.scope.project_codes, ['A'])
      assert.deepEqual(result.scope.masks, [0, 65535])
    }
    grants = [grant('view', 'A')]
    assert.deepEqual((await loadProjectTabAuthorization({}, 'reader')).scope.masks, [0])
    for (const bad of [{ uid: 'other' }, { bundleHash: '' }, { policyRevision: -1 }, { authorizationExpiresAt: Date.now() - 1 }, { grants: undefined }]) {
      override = bad
      await assert.rejects(loadProjectTabAuthorization({}, 'reader'), { statusCode: 503 })
    }
    globalThis.__tabLoad = async () => {
      throw Object.assign(new Error('dependency unavailable'), { statusCode: 503 })
    }
    await assert.rejects(loadProjectTabAuthorization({}, 'reader'), { statusCode: 503 })
  } finally {
    hooks.deregister()
    delete globalThis.__tabLoad
  }
})
