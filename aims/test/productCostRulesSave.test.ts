import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { createError } from 'h3'

const code = ts.transpileModule(readFileSync(new URL('../server/utils/productCostRulesSave.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText

test('rules save binds actor, freezes before delivery and preserves committed request after wake failure', async () => {
  for (const mode of ['ok', 'wake-failure', 'denied', 'injection', 'overallocated']) {
    const calls: string[] = []
    const exports: Record<string, (event: unknown) => Promise<unknown>> = {}
    const requestId = '00000000-0000-4000-8000-000000000001'
    const key = 'aims:product-cost-rules:' + requestId
    const input: Record<string, unknown> = { requestId, projectCode: 'PRJ', periodMonth: '2026-09', expectedRevision: 0, evidenceRef: 'review', shares: [{ productCode: 'P1', basisPoints: mode === 'overallocated' ? 10001 : 5000 }] }
    if (mode === 'injection') input.actorUid = 'attacker'
    let status = 200
    runInNewContext(code, { exports, TextEncoder, require: (name: string) => {
      if (name === 'h3') return { createError, getQuery: () => ({}), getRouterParam: () => '1', readBody: async () => input, setHeader: () => {},
        setResponseStatus: (_event: unknown, value: number) => { status = value } }
      if (name === './productCostRulesAuthorization') return { requireProductCostRulesProjectPermission: async () => {
        calls.push('auth')
        if (mode === 'denied') throw createError({ statusCode: 403 })
        return { actorUid: 'U1', projectId: '1', projectCode: 'PRJ', resource: 'projects', action: 'edit' }
      } }
      if (name.endsWith('/tenantRuntimeClient')) return { maybeCallTenantRuntime: async (_event: unknown, path: string, options: { scope: string, body: { command: Record<string, unknown>, authorization: Record<string, unknown> } }) => {
        calls.push('freeze')
        assert.equal(path, '/v1/aims/internal/product-cost-rules:freeze')
        assert.equal(options.scope, 'aims.write aims:product-cost-rules:freeze')
        assert.equal(options.body.command.actorUid, 'U1')
        assert.equal(options.body.authorization.purpose, 'product_cost_rules_freeze')
        return { handled: true, data: { code: 0, data: { requestId, operationKey: key, projectCode: 'PRJ' } } }
      } }
      if (name === './serviceTicketDeliveryOperation') return { createRequestServiceTicketDeliveryOperationIO: () => ({ callRuntime: async () => {
        calls.push('claim')
        if (mode === 'wake-failure') throw createError({ statusCode: 503 })
        return { operationKey: key, command: { actorUid: 'U1', projectCode: 'PRJ' } }
      } }) }
      if (name === './productCostRulesOperationExecutor') return { executeClaimedProductCostRulesOperation: async () => {
        calls.push('execute')
        return { synced: true }
      } }
      if (name === './aimsRuntimeForward') return { runtimeEnvelopeError: () => createError({ statusCode: 503 }) }
      throw new Error(name)
    } })
    const result = exports.handleProductCostRulesSave!({ method: 'POST' })
    if (['denied', 'injection', 'overallocated'].includes(mode)) {
      await assert.rejects(result, { statusCode: mode === 'denied' ? 403 : 400 })
      assert.equal(calls.includes('freeze'), false)
    } else {
      const response = await result as { data: { requestId: string, pending: boolean } }
      assert.equal(response.data.requestId, requestId)
      assert.equal(response.data.pending, mode === 'wake-failure')
      assert.equal(status, mode === 'wake-failure' ? 202 : 200)
      assert.deepEqual(calls.slice(0, 3), ['auth', 'freeze', 'claim'])
    }
  }
})
