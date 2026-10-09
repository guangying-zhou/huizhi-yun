/* eslint-disable @typescript-eslint/no-explicit-any -- Execute the transpiled Nuxt utility with controlled boundary adapters. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { createError } from 'h3'

const uuid = '00000000-0000-4000-8000-000000000001'
const compiled = ts.transpileModule(readFileSync(new URL('../server/utils/productDocumentCodocs.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
function harness(failure = '') {
  const exports: any = {}
  const calls: any[] = []
  runInNewContext(compiled, { exports, URL, $fetch: async (url: string, options: any) => {
    calls.push({ url, options })
    if (failure === 'upstream') throw createError({ statusCode: 503 })
    if (url.endsWith('/create')) return { code: 0, data: { receiptId: uuid, receiptStatus: 'succeeded', idempotent: true, targetBizType: 'product_document', targetBizCode: failure === 'identity' ? 'other' : uuid, responseSummarySha256: 'a'.repeat(64), result: { uuid, title: 'Spec', productCode: 'P' } } }
    if (url.endsWith('/content')) return { code: 0, data: { uuid: failure === 'identity' ? 'other' : uuid, title: '说明', docType: 'product', updatedAt: '2026-09-08', content: failure === 'content' ? null : '# 产品', contentSize: 8, ossPath: 'secret' } }
    if (url.endsWith('/search')) return { code: 0, data: { items: [{ uuid: failure === 'identity' ? 'invalid' : uuid, title: '说明', doc_type: 'product', updated_at: '2026-09-08', secret: 'hidden' }], total: 21, page: 2, pageSize: 20 } }
    return { code: 0, data: { uuid: failure === 'identity' ? 'other' : uuid, title: '说明', doc_type: 'product', updated_at: '2026-09-08', oss_path: 'secret' } }
  }, require: (name: string) => {
    if (name === 'h3') return { createError, getHeader: () => 'request-1' }
    if (name.endsWith('/productCrossDependencyInput')) return { crossDependencyProductCode: (code: string) => code === 'P' }
    if (name.endsWith('/productAuthorization')) return { requireProductPermission: async (...args: any[]) => {
      calls.push({ permission: args.slice(1) })
      if (failure === 'permission') throw createError({ statusCode: 404 })
      return { product_code: 'P', actor_uid: 'session-user' }
    } }
    if (name.endsWith('/tenantGatewayTrust')) return { resolveTrustedTenantGatewayContext: () => ({ tenant: 'TENANT', deployment: 'source-aims' }) }
    if (name.endsWith('/serviceAppUrl')) return { resolveTrustedServiceAppRoute: () => failure === 'route' ? null : { baseUrl: 'https://codocs.example/codocs', deploymentCode: 'target-codocs' } }
    if (name.endsWith('/serviceOidc')) return {
      requestServiceAccessToken: async (args: any) => {
        calls.push({ token: args })
        return 'token'
      },
      trustedServiceRequestHeaders: () => ({ 'x-hzy-app-code': 'codocs', 'x-hzy-deployment': 'target-codocs', 'x-forwarded-prefix': '/codocs' })
    }
    if (name.endsWith('/tenantRuntimeClient')) return {
      hashServiceCommandPayload: async () => 'a'.repeat(64),
      buildServiceCommandRuntimeHeaders: async (args: any) => {
        calls.push({ signature: args })
        return { signed: 'yes' }
      }
    }
    throw new Error(name)
  } })
  return { calls, create: () => exports.createProductDocumentFromTemplate({}, 'P', { actorUid: failure === 'actor-change' ? 'original-user' : 'session-user', operationId: uuid, idempotencyKey: 'stable-key', documentUuid: uuid, templateUuid: '00000000-0000-4000-8000-000000000002', title: 'Spec' }), content: () => exports.readProductDocumentContent({}, 'P', uuid), run: () => exports.readProductDocumentMetadata({}, 'P', uuid), search: (text = '需求') => exports.searchProductDocuments({}, 'P', text, 2, 20) }
}
test('product document caller binds session actor and distinct trusted deployments', async () => {
  const h = harness()
  const result = await h.run()
  assert.deepEqual(Array.from(h.calls[0].permission), ['P', 'product_documents', 'view'])
  assert.equal(h.calls[1].token.audience, 'codocs')
  assert.equal(h.calls[1].token.scope, 'codocs:product-document:read')
  const signed = h.calls[2].signature
  assert.equal(signed.sourceDeploymentCode, 'source-aims')
  assert.equal(signed.targetDeploymentCode, 'target-codocs')
  assert.equal(signed.envelope.command.actorUid, 'session-user')
  assert.equal(signed.requestTarget, `/codocs/api/v1/service/product-documents/${uuid}/metadata`)
  assert.equal(h.calls[3].options.headers['x-forwarded-prefix'], '/codocs')
  assert.equal(h.calls[3].options.headers['x-hzy-app-code'], 'codocs')
  assert.equal(h.calls[3].options.headers['x-hzy-deployment'], 'target-codocs')
  assert.deepEqual(Object.keys(result).sort(), ['doc_type', 'title', 'updated_at', 'uuid'])
})
test('product document caller fails before token issuance without permission or route', async () => {
  for (const failure of ['permission', 'route']) {
    const h = harness(failure)
    await assert.rejects(h.run(), { statusCode: failure === 'permission' ? 404 : 503 })
    assert.equal(h.calls.length, 1)
  }
  for (const failure of ['identity', 'upstream']) await assert.rejects(harness(failure).run(), { statusCode: 503 })
})

test('search caller signs search/page and validates visible pagination', async () => {
  const h = harness()
  const result = await h.search()
  const signed = h.calls.find(call => call.signature).signature
  assert.equal(signed.envelope.operationCode, 'aims.codocs.product-document.search.v1')
  assert.equal(signed.envelope.command.actorUid, 'session-user')
  assert.equal(signed.envelope.command.search, '需求')
  assert.equal(signed.envelope.command.page, 2)
  assert.equal(signed.envelope.command.pageSize, 20)
  assert.ok(signed.requestTarget.endsWith('/product-documents/search'))
  assert.equal(result.total, 21)
  assert.equal(result.items.length, 1)
  assert.equal(result.items[0].secret, undefined)
  await assert.rejects(harness('identity').search(), { statusCode: 503 })
  const invalid = harness()
  await assert.rejects(invalid.search('bad\n'), { statusCode: 400 })
  assert.equal(invalid.calls.length, 0)
})

test('content caller signs distinct content operation and strips storage fields', async () => {
  const h = harness()
  const data = await h.content()
  const signed = h.calls.find(call => call.signature).signature
  assert.equal(signed.envelope.operationCode, 'aims.codocs.product-document.content-read.v1')
  assert.equal(signed.envelope.command.action, 'content:read')
  assert.equal(signed.envelope.command.actorUid, 'session-user')
  assert.equal(signed.requestTarget, `/codocs/api/v1/service/product-documents/${uuid}/content`)
  assert.deepEqual(Object.keys(data).sort(), ['content', 'contentSize', 'docType', 'title', 'updatedAt', 'uuid'])
  assert.equal(data.content, '# 产品')
  for (const failure of ['identity', 'content', 'upstream', 'route']) await assert.rejects(harness(failure).content(), { statusCode: 503 })
  const denied = harness('permission')
  await assert.rejects(denied.content(), { statusCode: 404 })
  assert.equal(denied.calls.length, 1)
})

test('template creation caller retains persisted identity and uses exact create capability', async () => {
  const h = harness()
  const result = await h.create()
  assert.equal(result.documentUuid, uuid)
  assert.deepEqual(Array.from(h.calls[0].permission), ['P', 'product_documents', 'edit'])
  const signature = h.calls.find(call => call.signature).signature
  assert.equal(signature.envelope.operationId, uuid)
  assert.equal(signature.envelope.idempotencyKey, 'stable-key')
  assert.equal(signature.envelope.requiredCapability, 'codocs:product-document:create')
  assert.equal(signature.envelope.commandSchemaVersion, 'product-document-create.v1')
  assert.equal(signature.envelope.command.actorUid, 'session-user')
  for (const failure of ['identity', 'upstream']) await assert.rejects(harness(failure).create(), { statusCode: 503 })
  await assert.rejects(harness('permission').create(), { statusCode: 404 })
})

test('template creation retry cannot replace the frozen actor with current session user', async () => {
  const h = harness('actor-change')
  await assert.rejects(h.create(), { statusCode: 403 })
  assert.equal(h.calls.length, 1)
  assert.equal(h.calls.some(call => call.token || call.signature || call.url), false)
})
