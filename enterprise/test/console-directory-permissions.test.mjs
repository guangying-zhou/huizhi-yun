import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'

test('department edit visibility comes from gated Console snapshot, not Host view or browser identity', async () => {
  const state = { resources: {}, gate: 0, calls: [] }
  globalThis.__directoryPermissions = state
  const hooks = registerHooks({ resolve(specifier, context, next) {
    const code = specifier === '@hzy/foundation/server/utils/enterpriseRuntimeClient'
      ? 'export async function requireEnterpriseUser(){return {uid:"verified-user"}}'
      : specifier === '@hzy/foundation/server/utils/platformBundleAuthorization'
        ? 'export async function loadAuthorizationSnapshotFromConsoleRuntime(uid,module){const s=globalThis.__directoryPermissions;s.calls.push({uid,module});return {resources:s.resources}}'
        : specifier.endsWith('/enterprisePolicyGate')
          ? 'export async function requireCurrentEnterprisePolicy(){const s=globalThis.__directoryPermissions;if(s.gate)throw Object.assign(Error("gate"),{statusCode:s.gate})}'
          : null
    if (code) return { shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(code)}` }
    if (specifier === '@hzy/foundation/shared/utils/authorizationActions') return { shortCircuit: true, url: new URL('../../foundation/shared/utils/authorizationActions.ts', import.meta.url).href }
    return next(specifier, context)
  } })
  try {
    const { consoleDirectoryEditPermission } = await import('../server/utils/consoleDirectoryPermissions.ts')
    for (const [resources, edit] of [[{}, false], [{ directory_departments: ['view'] }, false], [{ directory_departments: ['edit'] }, true], [{ directory_departments: ['admin'] }, true], [{ directory_projects: ['admin'] }, false]]) {
      state.resources = resources
      assert.equal(await consoleDirectoryEditPermission({ context: {}, node: { req: { headers: { 'x-hzy-actor-uid': 'forged' } } } }, 'directory_departments'), edit)
      assert.deepEqual(state.calls.at(-1), { uid: 'verified-user', module: 'console' })
    }
    for (const [resources, edit] of [[{}, false], [{ directory_projects: ['view'] }, false], [{ directory_projects: ['edit'] }, true], [{ directory_projects: ['admin'] }, true], [{ directory_departments: ['admin'] }, false]]) {
      state.resources = resources
      assert.equal(await consoleDirectoryEditPermission({}, 'directory_projects'), edit)
      assert.deepEqual(state.calls.at(-1), { uid: 'verified-user', module: 'console' })
    }
    const count = state.calls.length
    state.gate = 503
    await assert.rejects(consoleDirectoryEditPermission({}, 'directory_departments'), error => error.statusCode === 503)
    assert.equal(state.calls.length, count)
  } finally { hooks.deregister(); delete globalThis.__directoryPermissions }
})
