import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

// Execute the real permission entry points while controlling the Console boundary.
function permissionHarness(resources: Record<string, string[]>, failure?: Error) {
  const source = readFileSync(new URL('../server/utils/checkPermission.ts', import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText
  const createError = (options: object) => Object.assign(new Error('permission error'), options)
  const bindings = {
    createError, getHeader: () => undefined,
    appCode: 'altoc', resources: {},
    ensureAltocConsoleAuth: async () => {}, getRequestUid: () => 'user-1',
    loadAuthorizationSnapshotFromConsoleRuntime: async () => {
      if (failure) throw failure
      return { roles: [], resources, actionPolicies: {} }
    },
    authorizationActionsAllow: (actions: string[], action: string) => actions.includes(action),
    authorizationResourcesAllow: (values: Record<string, string[]>, resource: string, action: string) => values[resource]?.includes(action) || false
  }
  const exports: Record<string, (...args: unknown[]) => Promise<unknown>> = {}
  runInNewContext(compiled, {
    exports, require: () => bindings, createError,
    process: { env: {} }, useRuntimeConfig: () => ({}), console
  })
  return exports
}

for (const entry of ['checkPermission', 'requirePermission']) {
  test(`${entry} preserves dependency 503 before a protected operation`, async () => {
    const failure = Object.assign(new Error('Console unavailable'), { statusCode: 503 })
    const api = permissionHarness({}, failure)
    let mutations = 0
    await assert.rejects(async () => {
      await api[entry]!({ context: {} }, 'invoices', 'view')
      mutations += 1
    }, error => error === failure)
    assert.equal(mutations, 0)
  })
}

test('missing permission stays false/403 and an explicit permission succeeds', async () => {
  const denied = permissionHarness({})
  assert.equal(await denied.checkPermission!({ context: {} }, 'invoices', 'view'), false)
  await assert.rejects(denied.requirePermission!({ context: {} }, 'invoices', 'view'), { statusCode: 403 })
  const allowed = permissionHarness({ invoices: ['view'] })
  assert.equal(await allowed.checkPermission!({ context: {} }, 'invoices', 'view'), true)
  await allowed.requirePermission!({ context: {} }, 'invoices', 'view')
})
