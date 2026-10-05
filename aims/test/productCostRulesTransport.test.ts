import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { createError } from 'h3'
import { buildServiceCommandRuntimeHeaders, verifyServiceCommandRuntimeHeaders, hashServiceCommandPayload } from '@hzy/foundation/server/utils/tenantRuntimeClient'

const code = ts.transpileModule(readFileSync(new URL('../server/utils/productCostRulesTransport.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText

test('cost rules transport signs separate deployments and rejects missing routes before token issuance', async () => {
  for (const mode of ['request', 'scheduled', 'missing-route', 'wrong-tenant', 'scheduled-missing']) {
    const exports: Record<string, (...args: unknown[]) => Promise<unknown>> = {}
    let tokens = 0
    const command = { actorUid: 'original-user', projectCode: 'PRJ', periodMonth: '2026-09', expectedRevision: 2, evidenceRef: 'review', shares: [{ productCode: 'P1', basisPoints: 5000 }] }
    const envelope = { operationId: '123e4567-e89b-42d3-a456-426614174001', operationCode: 'aims.finance.product-cost.rules.replace.v1', targetApp: 'finance', requiredCapability: 'finance:product-cost:replace-rules', idempotencyKey: 'key', commandSchemaVersion: 'product-cost-rules.v1', commandSha256: await hashServiceCommandPayload(command), command }

    runInNewContext(code, { exports, URL, crypto: { randomUUID: () => 'request-id' }, require: (name: string) => {
      if (name === 'h3') return { createError }
      if (name.endsWith('/serviceAppUrl')) return {
        resolveServiceAppBaseUrl: () => 'https://tenant.example',
        resolveTrustedServiceAppRoute: () => mode === 'missing-route' ? null : { deploymentCode: 'FINANCE' }
      }
      if (name.endsWith('/tenantGatewayTrust')) return { resolveTrustedTenantGatewayContext: () => ({ tenant: mode === 'wrong-tenant' ? 'OTHER' : 'TENANT', deployment: 'AIMS', appCode: 'aims' }) }
      if (name.endsWith('/serviceOidc')) return { requestWithServiceAccessToken: async (options: { audience: string, scope: string, request: (token: string) => Promise<unknown> }) => {
        tokens++
        assert.equal(options.audience, 'finance')
        assert.equal(options.scope, 'finance:product-cost:replace-rules')
        return options.request('test-token')
      } }
      if (name.endsWith('/tenantRuntimeClient')) return { buildServiceCommandRuntimeHeaders: async (options: Record<string, unknown>) => {
        assert.equal(options.sourceDeploymentCode, 'AIMS')
        assert.equal(options.targetDeploymentCode, 'FINANCE')
        assert.equal(options.sourceClientId, 'aims.runtime')
        assert.equal(options.requestTarget, '/api/v1/finance/service/product-cost/replace-rules')
        return await buildServiceCommandRuntimeHeaders(options as unknown as Parameters<typeof buildServiceCommandRuntimeHeaders>[0])
      } }
      if (name.endsWith('/appServiceBinding')) return { serviceAppFetch: async (_event: unknown, _app: string, _url: string, options: { headers: Record<string, string> }) => {
        const verifyInput = {
          token: 'test-token', method: 'POST' as const, requestTarget: '/api/v1/finance/service/product-cost/replace-rules', requestId: 'request-id',
          tenantCode: 'TENANT', sourceDeploymentCode: 'AIMS', targetDeploymentCode: 'FINANCE', sourceApp: 'aims', sourceClientId: 'aims.runtime', targetApp: 'finance', envelope,
          readHeader: (name: string) => options.headers[name]
        }
        await verifyServiceCommandRuntimeHeaders(verifyInput)
        for (const changed of [{ token: 'different-token' }, { targetDeploymentCode: 'AIMS' }, { requestTarget: '/different-path' }]) {
          await assert.rejects(verifyServiceCommandRuntimeHeaders({ ...verifyInput, ...changed }))
        }
        const changedHash = await hashServiceCommandPayload({ ...command, expectedRevision: 4 })
        await assert.rejects(verifyServiceCommandRuntimeHeaders({ ...verifyInput, envelope: { ...envelope, commandSha256: changedHash } }))
        assert.equal(options.headers['x-hzy-deployment'], 'FINANCE')
        return { code: 0, data: { ok: true } }
      } }
      throw new Error(name)
    } })
    const pending = exports.sendProductCostRules!(mode.startsWith('scheduled') ? null : {}, { tenantCode: 'TENANT', deploymentCode: 'AIMS', idempotencyKey: 'key' }, { serviceCommand: envelope }, mode === 'scheduled' ? 'FINANCE' : '')
    if (['request', 'scheduled'].includes(mode)) {
      await pending
      assert.equal(tokens, 1)
    } else {
      await assert.rejects(pending, { statusCode: 503 })
      assert.equal(tokens, 0)
    }
  }
})
