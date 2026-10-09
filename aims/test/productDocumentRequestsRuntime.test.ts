/* eslint-disable @typescript-eslint/no-explicit-any -- Controlled VM adapters exercise malformed boundary responses. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { createError } from 'h3'

const id = '00000000-0000-4000-8000-000000000001'
const document = '00000000-0000-4000-8000-000000000002'
const compiled = ts.transpileModule(readFileSync(new URL('../server/utils/productDocumentRequestsRuntime.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
function harness(failure = '', query: object = { page: '2', pageSize: '1' }) {
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
      return { handled: true, data: { code: 0, data: { product_code: failure === 'foreign' ? 'OTHER' : 'P', workspace_revision: 1, total: 2, page: 2, pageSize: 1, items: failure === 'short' ? [] : [{ biz_id: id, document_uuid: document, purpose: 'design', linked: false, status: failure === 'invalid' ? 'invalid' : 'pending' }] } } }
    } }
    if (name.endsWith('/productDocumentCodocs')) return { readProductDocumentMetadata: async (_: any, code: string, uuid: string) => {
      calls.push({ content: uuid, code })
      if (failure === 'acl') throw createError({ statusCode: 403 })
      return { uuid, content: '# Content' }
    } }
    if (name.endsWith('/aimsRuntimeForward')) return { runtimeEnvelopeError: () => createError({ statusCode: 503 }) }
    throw new Error(name)
  } })
  return { calls, run: (method = 'GET') => exports.handleProductDocumentRequests({ method }) }
}
test('request history preserves server pagination and strips internal fields', async () => {
  const h = harness(), result = await h.run()
  assert.equal(result.data.page, 2)
  assert.equal(result.data.total, 2)
  assert.equal(result.data.items[0].requestBizId, id)
  assert.equal(result.data.items[0].document_uuid, undefined)
  assert.equal(h.calls[0].options.body.input.page, 2)
  assert.equal(h.calls[0].options.body.authorization.action, 'edit')
})
test('request history rejects malformed pagination and inconsistent service responses', async () => {
  for (const query of [{ page: '0' }, { pageSize: '101' }, { page: ['1'] }, { page: '1e2' }, { actorUid: 'other' }]) {
    const h = harness('', query)
    await assert.rejects(h.run(), { statusCode: 400 })
    assert.equal(h.calls.length, 0)
  }
  for (const [failure, statusCode] of [['permission', 403], ['foreign', 503], ['invalid', 503], ['short', 503], ['drift', 409]] as const) {
    await assert.rejects(harness(failure).run(), { statusCode })
  }
})
