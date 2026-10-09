/* eslint-disable @typescript-eslint/no-explicit-any -- Controlled VM adapters exercise malformed boundary responses. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { createError } from 'h3'

const id = '00000000-0000-4000-8000-000000000001'
const document = '00000000-0000-4000-8000-000000000002'
const compiled = ts.transpileModule(readFileSync(new URL('../server/utils/productDocumentRequestStatusRuntime.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
function harness(failure = '', query: object = { requestBizId: id }) {
  const exports: any = {}, calls: any[] = []
  let checks = 0
  runInNewContext(compiled, { exports, require: (name: string) => {
    if (name === 'h3') return { createError, getQuery: () => query, readBody: async () => ({ requestBizId: id }), getRouterParam: () => 'P', setHeader: () => {} }
    if (name.endsWith('/productDocumentDispatch')) return { dispatchProductDocumentRequest: async () => {
      calls.push({ dispatch: true })
    } }
    if (name.endsWith('/productCrossDependencyInput')) return { crossDependencyProductCode: () => true }
    if (name.endsWith('/productAuthorization')) return { requireProductPermission: async () => {
      checks++
      if (failure === 'permission') throw createError({ statusCode: 403 })
      return { product_code: 'P', actor_uid: 'reader', revision: failure === 'drift' && checks > 1 ? 2 : 1 }
    } }
    if (name.endsWith('/tenantRuntimeClient')) return { maybeCallTenantRuntime: async (_: any, path: string, options: any) => {
      calls.push({ path, options })
      return { handled: true, data: { code: 0, data: { product_code: failure === 'foreign' ? 'OTHER' : 'P', workspace_revision: 1, biz_id: id, document_uuid: document, status: ['pending', 'retry_wait', 'partial_unknown', 'processing', 'dead_letter', 'cancelled', 'failed_permanent'].includes(failure) ? failure : failure === 'invalid' ? 'invalid' : 'succeeded', relation_biz_id: '' } } }
    } }
    if (name.endsWith('/productDocumentCodocs')) return { readProductDocumentMetadata: async (_: any, code: string, uuid: string) => {
      calls.push({ content: uuid, code })
      if (failure === 'acl') throw createError({ statusCode: 403 })
      return { uuid, content: '# Content' }
    } }
    if (name.endsWith('/aimsRuntimeForward')) return { runtimeEnvelopeError: () => createError({ statusCode: 503 }) }
    throw new Error(name)
  } })
  return { calls, resume: () => exports.handleProductDocumentRequestResume({ method: 'POST' }), run: (method = 'GET') => exports.handleProductDocumentRequestStatus({ method }) }
}
test('request status reads only product request and exposes no internal document UUID', async () => {
  const h = harness(), result = await h.run()
  assert.equal(result.data.requestBizId, id)
  assert.equal(result.data.status, 'succeeded')
  assert.equal(result.data.document_uuid, undefined)
  assert.equal(h.calls[0].options.body.authorization.action, 'edit')
  assert.equal(h.calls[1].content, document)
  const pending = harness('pending')
  assert.equal((await pending.run()).data.status, 'pending')
  assert.equal(pending.calls.some(call => call.content), false)
})
test('request status rejects injection, foreign request, revoked ACL and authorization drift', async () => {
  const injected = harness('', { requestBizId: id, documentUuid: document })
  await assert.rejects(injected.run(), { statusCode: 400 })
  for (const [failure, statusCode] of [['permission', 403], ['foreign', 503], ['invalid', 503], ['acl', 403], ['drift', 409]] as const) {
    const h = harness(failure)
    await assert.rejects(h.run(), { statusCode })
  }
})

test('resume delivers only retryable original requests and GET remains read-only', async () => {
  for (const state of ['pending', 'retry_wait', 'partial_unknown', 'processing', 'dead_letter', 'cancelled', 'failed_permanent', 'succeeded']) {
    const h = harness(state, {})
    await h.resume()
    assert.equal(h.calls.some(call => call.dispatch), ['pending', 'retry_wait', 'partial_unknown'].includes(state))
  }
  const read = harness('pending')
  await read.run()
  assert.equal(read.calls.some(call => call.dispatch), false)
  const drift = harness('drift', {})
  await assert.rejects(drift.resume(), { statusCode: 409 })
  assert.equal(drift.calls.some(call => call.dispatch), false)
})
