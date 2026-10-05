import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { createError } from 'h3'
import { buildServiceCommandRuntimeHeaders, verifyServiceCommandRuntimeHeaders, hashServiceCommandPayload } from '@hzy/foundation/server/utils/tenantRuntimeClient'

const code = ts.transpileModule(readFileSync(new URL('../server/utils/productFeedbackTransport.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText

test('feedback transport signs separate deployments and rejects missing routes before token issuance', async () => {
  for (const mode of ['request', 'scheduled', 'missing-route', 'wrong-tenant', 'scheduled-missing']) {
    const exports: Record<string, (...args: unknown[]) => Promise<unknown>> = {}
    let tokens = 0
    const command = { actorUid: 'pm', productCode: 'P1', ticketCode: 'ST-1', requestBizId: '123e4567-e89b-42d3-a456-426614174000', title: 'Feature', description: '', action: 'create' }
    const envelope = { operationId: '123e4567-e89b-42d3-a456-426614174001', operationCode: 'altoc.aims.product-request.create-from-feedback.v1', targetApp: 'aims', requiredCapability: 'aims:product-request:create-from-feedback', idempotencyKey: 'key', commandSchemaVersion: 'product-feedback-create.v1', commandSha256: await hashServiceCommandPayload(command), command }

    runInNewContext(code, { exports, URL, crypto: { randomUUID: () => 'request-id' }, require: (name: string) => {
      if (name === 'h3') return { createError }
      if (name.endsWith('/serviceAppUrl')) return {
        resolveServiceAppBaseUrl: () => 'https://tenant.example',
        resolveTrustedServiceAppRoute: () => mode === 'missing-route' ? null : { deploymentCode: 'AIMS' }
      }
      if (name.endsWith('/tenantGatewayTrust')) return { resolveTrustedTenantGatewayContext: () => ({ tenant: mode === 'wrong-tenant' ? 'OTHER' : 'TENANT', deployment: 'ALTOC', appCode: 'altoc' }) }
      if (name.endsWith('/serviceOidc')) return { requestWithServiceAccessToken: async (options: { audience: string, scope: string, request: (token: string) => Promise<unknown> }) => {
        tokens++
        assert.equal(options.audience, 'aims')
        assert.equal(options.scope, 'aims:product-request:create-from-feedback')
        return options.request('test-token')
      } }
      if (name.endsWith('/tenantRuntimeClient')) return { buildServiceCommandRuntimeHeaders: async (options: Record<string, unknown>) => {
        assert.equal(options.sourceDeploymentCode, 'ALTOC')
        assert.equal(options.targetDeploymentCode, 'AIMS')
        assert.equal(options.sourceClientId, 'altoc.runtime')
        assert.equal(options.requestTarget, '/api/v1/service/product-requests/from-feedback')
        return await buildServiceCommandRuntimeHeaders(options as unknown as Parameters<typeof buildServiceCommandRuntimeHeaders>[0])
      } }
      if (name.endsWith('/appServiceBinding')) return { serviceAppFetch: async (_event: unknown, _app: string, _url: string, options: { headers: Record<string, string> }) => {
        const verifyInput = {
          token: 'test-token', method: 'POST' as const, requestTarget: '/api/v1/service/product-requests/from-feedback', requestId: 'request-id',
          tenantCode: 'TENANT', sourceDeploymentCode: 'ALTOC', targetDeploymentCode: 'AIMS', sourceApp: 'altoc', sourceClientId: 'altoc.runtime', targetApp: 'aims', envelope,
          readHeader: (name: string) => options.headers[name]
        }
        await verifyServiceCommandRuntimeHeaders(verifyInput)
        for (const changed of [{ token: 'different-token' }, { targetDeploymentCode: 'ALTOC' }, { requestTarget: '/different-path' }]) {
          await assert.rejects(verifyServiceCommandRuntimeHeaders({ ...verifyInput, ...changed }))
        }
        const changedHash = await hashServiceCommandPayload({ ...command, actorUid: 'other' })
        await assert.rejects(verifyServiceCommandRuntimeHeaders({ ...verifyInput, envelope: { ...envelope, commandSha256: changedHash } }))
        assert.equal(options.headers['x-hzy-deployment'], 'AIMS')
        return { code: 0, data: { ok: true } }
      } }
      throw new Error(name)
    } })
    const pending = exports.sendProductFeedback!(mode.startsWith('scheduled') ? null : {}, { tenantCode: 'TENANT', deploymentCode: 'ALTOC', idempotencyKey: 'key' }, { serviceCommand: envelope }, mode === 'scheduled' ? 'AIMS' : '')
    if (['request', 'scheduled'].includes(mode)) {
      await pending
      assert.equal(tokens, 1)
    } else {
      await assert.rejects(pending, { statusCode: 503 })
      assert.equal(tokens, 0)
    }
  }
})
