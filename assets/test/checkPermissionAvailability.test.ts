import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { Script, createContext } from 'node:vm'
import ts from 'typescript'

test('permission checks distinguish anonymous, denied and unavailable without exposing diagnostics', async () => {
  const source = readFileSync(new URL('../server/utils/checkPermission.ts', import.meta.url), 'utf8').replace(/^import .*$/gm, '').replace(/export async function/g, 'async function')
  let uid = 'verified-user', failure = false, allowed = false, loads = 0
  const context = createContext({
    appCode: 'assets', manifestResources: {},
    ensureAssetsConsoleAuth: async () => {},
    getRequestUid: () => uid,
    isAssetsLocalDevAuthorizationBypassEnabled: () => false,
    loadAuthorizationSnapshotFromConsoleRuntime: async () => {
      loads++
      if (failure) throw new Error('PRIVATE backend URL or credential diagnostic')
      return { resources: {}, actionPolicies: {} }
    },
    authorizationResourcesAllow: () => allowed,
    createError: (input: { statusCode: number, message: string }) => Object.assign(new Error(input.message), input)
  })
  new Script(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText).runInContext(context)
  const status = (expected: number) => (error: unknown) => {
    assert.equal((error as { statusCode: number }).statusCode, expected)
    assert.equal(String(error).includes('PRIVATE'), false)
    return true
  }
  assert.equal(await context.checkPermission({}, 'products', 'view'), false)
  await assert.rejects(context.requirePermission({}, 'products', 'view'), status(403))
  allowed = true
  await context.requirePermission({}, 'products', 'view')
  failure = true
  await assert.rejects(context.checkPermission({}, 'products', 'view'), status(503))
  await assert.rejects(context.requirePermission({}, 'products', 'view'), status(503))
  uid = ''
  const before = loads
  assert.equal(await context.checkPermission({}, 'products', 'view'), false)
  await assert.rejects(context.requirePermission({}, 'products', 'view'), status(401))
  assert.equal(loads, before)
})
