/* eslint-disable @typescript-eslint/no-explicit-any -- VM captures transport and signing adapter inputs. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { createError } from 'h3'

const compiled = ts.transpileModule(readFileSync(new URL('../server/utils/serviceTicketDeliveryOperation.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
function harness(mode = '') {
  const exports: any = {}, calls: any[] = []
  runInNewContext(compiled, { exports, URL, crypto: { randomUUID: () => 'request-id' }, require: (name: string) => {
    if (name === 'h3') return { createError, getHeader: () => 'request-id' }
    if (name.endsWith('/serviceAppUrl')) return { resolveServiceAppBaseUrl: () => 'https://codocs.test/api/v1', resolveTrustedServiceAppRoute: () => mode === 'missing-route' ? null : { deploymentCode: 'CODOCS' } }
    if (name.endsWith('/tenantGatewayTrust')) return { resolveTrustedTenantGatewayContext: () => mode === 'missing-gateway' ? null : { tenant: mode === 'foreign' ? 'OTHER' : 'TENANT', deployment: 'AIMS' } }
    if (name.endsWith('/serviceOidc')) return {
      requestWithServiceAccessToken: async (options: any) => {
        calls.push({ token: options.audience, scope: options.scope })
        return options.request('test-token')
      },
      trustedServiceRequestHeaders: () => ({ 'x-hzy-app-code': 'codocs', 'x-hzy-deployment': 'CODOCS', 'x-hzy-path-prefix': '/codocs' })
    }
    if (name.endsWith('/tenantRuntimeClient')) return { buildServiceCommandRuntimeHeaders: async (options: any) => {
      calls.push({ signature: options })
      return { 'x-signed': 'yes' }
    } }
    if (name.endsWith('/appServiceBinding')) return { serviceAppFetch: async (_: any, app: string, url: string, options: any) => {
      calls.push({ app, url, options })
      return { code: 0, data: { receiptId: 'receipt' } }
    } }
    if (name.startsWith('./')) return {}
    throw new Error(name)
  } })
  const operation = { tenantCode: 'TENANT', deploymentCode: 'AIMS', operationCode: 'aims.codocs.product-document.create.v1', idempotencyKey: 'original-key' }
  const envelope = { serviceCommand: { command: { actorUid: 'original-user' }, commandSchemaVersion: 'product-document-create.v1' } }
  return { calls, run: (scheduled = false, deployment = 'CODOCS') => {
    const io = scheduled ? exports.createScheduledServiceTicketDeliveryOperationIO(() => {}, { codocs: deployment }) : exports.createRequestServiceTicketDeliveryOperationIO({})
    return io.callCodocsProductDocument(envelope, operation)
  } }
}
test('product creation transport binds exact URL, scope and distinct source/target signature deployments', async () => {
  for (const scheduled of [false, true]) {
    const h = harness()
    assert.equal((await h.run(scheduled)).receiptId, 'receipt')
    assert.equal(h.calls[0].scope, 'codocs:product-document:create')
    assert.equal(h.calls[0].token, 'codocs')
    assert.equal(h.calls[1].signature.sourceDeploymentCode, 'AIMS')
    assert.equal(h.calls[1].signature.targetDeploymentCode, 'CODOCS')
    assert.equal(h.calls[1].signature.envelope.command.actorUid, 'original-user')
    assert.equal(h.calls[2].url, 'https://codocs.test/api/v1/service/product-documents/create')
    assert.equal(h.calls[2].options.headers['x-hzy-deployment'], 'CODOCS')
    assert.equal(h.calls[2].options.headers['idempotency-key'], 'original-key')
  }
})
test('missing or foreign trusted routing rejects before token issuance; scheduled delivery has no source fallback', async () => {
  for (const mode of ['missing-route', 'missing-gateway', 'foreign']) {
    const h = harness(mode)
    await assert.rejects(h.run(), { statusCode: mode === 'foreign' ? 403 : 503 })
    assert.equal(h.calls.length, 0)
  }
  const h = harness()
  await assert.rejects(h.run(true, ''), { statusCode: 503 })
  assert.equal(h.calls.length, 0)
})
