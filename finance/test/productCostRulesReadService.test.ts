import { productCostRuntimeError } from '../server/utils/productCostRuntimeError.ts'
import { parseProductCostRulesReadInput, parseProductCostRulesReadResult } from '../server/utils/productCostRulesReadInput.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { createError } from 'h3'

const code = ts.transpileModule(readFileSync(new URL('../server/utils/productCostRulesReadService.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ESNext } }).outputText
test('cost handler verifies before delegated authorization and runtime access', async () => {
  for (const mode of ['valid', 'identity', 'signature', 'injected', 'scope-denied', 'wrong-result']) {
    const exports: Record<string, (event: unknown) => Promise<{ code: number }>> = {}
    const calls: string[] = []
    const envelope = { operationId: 'a1111111-1111-4111-8111-111111111111', targetApp: 'finance', operationCode: 'aims.finance.product-cost.rules.read.v1', commandSchemaVersion: 'product-cost-rules-read.v1', requiredCapability: 'finance:product-cost:read-rules', idempotencyKey: 'query-1', commandSha256: 'digest', command: { actorUid: 'U1', projectCode: 'PRJ-1', periodMonth: '2026-09', action: 'read' } }
    runInNewContext(code, { exports, require: (name: string) => {
      if (name === './productCostRulesReadInput') return { parseProductCostRulesReadInput, parseProductCostRulesReadResult }
      if (name === './productCostRuntimeError') return { productCostRuntimeError }
      if (name === 'h3') return { createError, setHeader: () => {}, getMethod: () => 'POST', getQuery: () => ({}), getRequestURL: () => new URL('https://finance.test/api/v1/finance/service/product-cost/read'), getHeader: (_event: unknown, key: string) => key === 'authorization' ? 'Bearer token' : '', readBody: async () => ({ serviceCommand: envelope, ...(mode === 'injected' ? { productCostRulesAuthorization: { access: 'all' } } : {}) }) }
      if (name === './productCostServiceAuth') return { productCostRulesReadCapability: 'finance:product-cost:read-rules', requireProductCostRulesReadServiceAuth: async () => {
        calls.push('identity')
        if (mode === 'identity') throw createError({ statusCode: 401 })
        return { tenant: 'T', sourceDeployment: 'AIMS', targetDeployment: 'FINANCE' }
      } }
      if (name === './productCostAuthorization') return { resolveProductCostRulesAuthorization: async (_event: unknown, uid: string) => {
        calls.push('scopes')
        assert.equal(uid, 'U1')
        if (mode === 'scope-denied') throw createError({ statusCode: 403 })
        return { current_user: uid, current_user_project_finance_access: 'projects', current_user_project_finance_project_codes: 'PRJ-1' }
      } }
      if (name.endsWith('/tenantRuntimeClient')) return {
        hashServiceCommandPayload: async () => 'digest',
        verifyServiceCommandRuntimeHeaders: async (input: { sourceDeploymentCode: string, targetDeploymentCode: string }) => {
          calls.push('signature')
          assert.equal(input.sourceDeploymentCode, 'AIMS')
          assert.equal(input.targetDeploymentCode, 'FINANCE')
          if (mode === 'signature') throw createError({ statusCode: 403 })
        },
        maybeCallTenantRuntime: async (_event: unknown, path: string, options: { serviceCommandActor: { uid: string }, body: { productCostRulesAuthorization: { expiresAt: number } } }) => {
          calls.push('runtime')
          assert.equal(path, '/v1/finance/internal/product-cost:read-rules')
          assert.equal(options.serviceCommandActor.uid, 'U1')
          assert.ok(options.body.productCostRulesAuthorization.expiresAt > Date.now())
          return { handled: true, data: { code: 0, data: { projectCode: mode === 'wrong-result' ? 'OTHER' : 'PRJ-1', periodMonth: '2026-09', revision: 1, evidenceRef: 'review', shares: [{ productCode: 'P1', basisPoints: 5000 }] } } }
        }
      }
      throw new Error(name)
    } })
    const promise = exports.handleProductCostRulesReadService!({})
    if (mode === 'valid') {
      assert.equal((await promise).code, 0)
      assert.deepEqual(calls, ['identity', 'signature', 'scopes', 'runtime'])
    } else {
      await assert.rejects(promise, { statusCode: mode === 'identity' ? 401 : mode === 'wrong-result' ? 503 : 403 })
      if (mode !== 'wrong-result') assert.ok(!calls.includes('runtime'))
    }
  }
})
