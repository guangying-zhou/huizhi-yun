/* eslint-disable @typescript-eslint/no-explicit-any -- Controlled VM adapters exercise malformed boundary responses. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { createError } from 'h3'

const id = '00000000-0000-4000-8000-000000000001'
const document = '00000000-0000-4000-8000-000000000002'
const compiled = ts.transpileModule(readFileSync(new URL('../server/utils/productDocumentContentRuntime.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
function harness(failure = '', query: object = { bizId: id }) {
  const exports: any = {}, calls: any[] = []
  let checks = 0
  runInNewContext(compiled, { exports, require: (name: string) => {
    if (name === 'h3') return { createError, getQuery: () => query, getRouterParam: () => 'P', setHeader: () => {} }
    if (name.endsWith('/productCrossDependencyInput')) return { crossDependencyProductCode: () => true }
    if (name.endsWith('/productAuthorization')) return { requireProductPermission: async () => {
      checks++
      if (failure === 'permission') throw createError({ statusCode: 403 })
      return { product_code: 'P', actor_uid: 'reader', revision: failure === 'drift' && checks > 1 ? 2 : 1 }
    } }
    if (name.endsWith('/tenantRuntimeClient')) return { maybeCallTenantRuntime: async (_: any, path: string, options: any) => {
      calls.push({ path, options })
      return { handled: true, data: { code: 0, data: { product_code: 'P', workspace_revision: 1, item: { biz_id: id, product_code: failure === 'foreign' ? 'OTHER' : 'P', document_uuid: document, removed: failure === 'removed' } } } }
    } }
    if (name.endsWith('/productDocumentCodocs')) return { readProductDocumentContent: async (_: any, code: string, uuid: string) => {
      calls.push({ content: uuid, code })
      if (failure === 'acl') throw createError({ statusCode: 403 })
      return { uuid, content: '# Content' }
    } }
    if (name.endsWith('/aimsRuntimeForward')) return { runtimeEnvelopeError: () => createError({ statusCode: 503 }) }
    throw new Error(name)
  } })
  return { calls, run: (method = 'GET') => exports.handleProductDocumentContent({ method }) }
}
test('content BFF resolves UUID from current product relation and delegates current actor', async () => {
  const h = harness(), result = await h.run()
  assert.equal(result.data.uuid, document)
  assert.equal(h.calls[0].options.scope, 'aims.read aims:product-documents:read')
  assert.equal(h.calls[0].options.query.current_user, 'reader')
  assert.equal(h.calls[0].options.body.input.biz_id, id)
  assert.equal(h.calls[1].content, document)
})
test('content BFF rejects injection, removed/foreign relations, ACL denial and revision drift', async () => {
  for (const query of [{ bizId: id, documentUuid: document }, { bizId: [id] }, { bizId: 'invalid' }]) {
    const h = harness('', query)
    await assert.rejects(h.run(), { statusCode: 400 })
    assert.equal(h.calls.length, 0)
  }
  for (const [failure, statusCode] of [['permission', 403], ['foreign', 503], ['removed', 404], ['acl', 403], ['drift', 409]] as const) {
    const h = harness(failure)
    await assert.rejects(h.run(), { statusCode })
    if (['permission', 'foreign', 'removed'].includes(failure)) assert.equal(h.calls.some(call => call.content), false)
  }
  await assert.rejects(harness().run('POST'), { statusCode: 405 })
})
