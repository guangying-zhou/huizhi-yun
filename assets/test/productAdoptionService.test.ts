import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { createError } from 'h3'

const code = ts.transpileModule(readFileSync(new URL('../server/utils/productAdoptionService.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ESNext } }).outputText
test('adoption handler verifies before delegated authorization and runtime access', async () => {
  for (const mode of ['valid', 'identity', 'signature', 'injected', 'scope-denied', 'wrong-result']) {
    const exports: Record<string, (event: unknown) => Promise<{ code: number }>> = {}
    const calls: string[] = []
    const envelope = { operationId: 'a1111111-1111-4111-8111-111111111111', targetApp: 'assets', operationCode: 'aims.assets.product-adoption.read.v1', commandSchemaVersion: 'aims.assets.product-adoption.read.v1', requiredCapability: 'assets:product-adoption:read', idempotencyKey: 'query-1', commandSha256: 'digest', command: { actorUid: 'U1', productCode: 'PROD', action: 'read', page: 1, pageSize: 20 } }
    runInNewContext(code, { exports, require: (name: string) => {
      if (name === 'h3') return { createError, setHeader: () => {}, getMethod: () => 'POST', getQuery: () => ({}), getRequestURL: () => new URL('https://assets.test/api/v1/service/product-adoption/read'), getHeader: (_event: unknown, key: string) => key === 'authorization' ? 'Bearer token' : '', readBody: async () => ({ serviceCommand: envelope, ...(mode === 'injected' ? { productAdoptionAuthorization: { access: 'all' } } : {}) }) }
      if (name === './productAdoptionServiceAuth') return { productAdoptionReadCapability: 'assets:product-adoption:read', requireProductAdoptionServiceAuth: async () => {
        calls.push('identity')
        if (mode === 'identity') throw createError({ statusCode: 401 })
        return { tenant: 'T', sourceDeployment: 'AIMS', targetDeployment: 'ASSETS' }
      } }
      if (name === './productAdoptionAuthorization') return { resolveProductAdoptionAuthorization: async (_event: unknown, uid: string) => {
        calls.push('scopes')
        assert.equal(uid, 'U1')
        if (mode === 'scope-denied') throw createError({ statusCode: 403 })
        return { delivery: { current_user: uid }, environment: { current_user: uid } }
      } }
      if (name.endsWith('/tenantRuntimeClient')) return {
        hashServiceCommandPayload: async () => 'digest',
        verifyServiceCommandRuntimeHeaders: async (input: { sourceDeploymentCode: string, targetDeploymentCode: string }) => {
          calls.push('signature')
          assert.equal(input.sourceDeploymentCode, 'AIMS')
          assert.equal(input.targetDeploymentCode, 'ASSETS')
          if (mode === 'signature') throw createError({ statusCode: 403 })
        },
        maybeCallTenantRuntime: async (_event: unknown, path: string, options: { serviceCommandActor: { uid: string }, body: { productAdoptionAuthorization: { expiresAt: number } } }) => {
          calls.push('runtime')
          assert.equal(path, '/v1/assets/internal/product-adoption:read')
          assert.equal(options.serviceCommandActor.uid, 'U1')
          assert.ok(options.body.productAdoptionAuthorization.expiresAt > Date.now())
          return { handled: true, data: { code: 0, data: { productCode: mode === 'wrong-result' ? 'OTHER' : 'PROD', page: 1, pageSize: 20, total: 0, items: [] } } }
        }
      }
      throw new Error(name)
    } })
    const promise = exports.handleProductAdoptionService!({})
    if (mode === 'valid') {
      assert.equal((await promise).code, 0)
      assert.deepEqual(calls, ['identity', 'signature', 'scopes', 'runtime'])
    } else {
      await assert.rejects(promise, { statusCode: mode === 'identity' ? 401 : mode === 'wrong-result' ? 503 : 403 })
      if (mode !== 'wrong-result') assert.ok(!calls.includes('runtime'))
    }
  }
})
