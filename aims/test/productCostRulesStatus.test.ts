import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { createError } from 'h3'

const code = ts.transpileModule(readFileSync(new URL('../server/utils/productCostRulesStatus.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
test('rules status requires current project permission and returns only consistent status fields', async () => {
  for (const mode of ['succeeded', 'dead_letter', 'retry_wait', 'wrong-project', 'inconsistent', 'denied']) {
    const exports: Record<string, (...args: unknown[]) => Promise<unknown>> = {}
    let runtimeCalls = 0
    const requestId = '00000000-0000-4000-8000-000000000001'
    runInNewContext(code, { exports, require: (name: string) => {
      if (name === 'h3') return { createError, getQuery: () => ({ projectCode: 'PRJ' }), setHeader: () => {} }
      if (name === './productCostRulesAuthorization') return { requireProductCostRulesProjectPermission: async () => {
        if (mode === 'denied') throw createError({ statusCode: 403 })
        return { actorUid: 'U1', projectCode: 'PRJ', projectId: '1', resource: 'projects', action: 'edit' }
      } }
      if (name.endsWith('/tenantRuntimeClient')) return { maybeCallTenantRuntime: async (_event: unknown, path: string, options: { scope: string, body: { authorization: { purpose: string } } }) => {
        runtimeCalls++
        assert.equal(path, '/v1/aims/internal/product-cost-rules:status')
        assert.equal(options.scope, 'aims.read aims:product-cost-rules:status')
        assert.equal(options.body.authorization.purpose, 'product_cost_rules_status')
        const status = ['wrong-project', 'inconsistent'].includes(mode) ? 'succeeded' : mode
        return { handled: true, data: { code: 0, data: { requestId, projectCode: mode === 'wrong-project' ? 'OTHER' : 'PRJ', status, synced: mode !== 'inconsistent' && status === 'succeeded', pending: status === 'retry_wait', command: { secret: 'hidden' } } } }
      } }
      if (name === './aimsRuntimeForward') return { runtimeEnvelopeError: () => createError({ statusCode: 503 }) }
      throw new Error(name)
    } })
    const pending = exports.handleProductCostRulesStatus!({ method: 'GET' }, '1', requestId)
    if (['wrong-project', 'inconsistent', 'denied'].includes(mode)) {
      await assert.rejects(pending, { statusCode: mode === 'denied' ? 403 : 503 })
      if (mode === 'denied') assert.equal(runtimeCalls, 0)
    } else {
      const result = await pending
      assert.equal(JSON.stringify(result).includes('hidden'), false)
    }
  }
})
