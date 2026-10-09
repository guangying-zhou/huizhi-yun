/* eslint-disable @typescript-eslint/no-explicit-any -- Controlled adapters around the real BFF and visibility helper. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { createError } from 'h3'
import * as visibility from '../server/utils/productDocumentVisibility'
import * as input from '../server/utils/productModelInput'
import * as errors from '../../foundation/server/utils/serviceOperation'

const uuid = '00000000-0000-4000-8000-000000000001'
const compiled = ts.transpileModule(readFileSync(new URL('../server/utils/productDocumentRuntime.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
function harness(errorCode = '', statusCode = 403, editAllowed = true, editRevision = 3, productStatus = 'active') {
  const exports: any = {}, calls: any[] = []
  runInNewContext(compiled, { exports, require: (name: string) => {
    if (name === 'h3') return { createError, getQuery: () => ({}), getRouterParam: () => 'P', setHeader: () => {} }
    if (name.endsWith('/serviceOperation')) return errors
    if (name.endsWith('/productModelInput')) return input
    if (name.endsWith('/productCrossDependencyInput')) return { crossDependencyProductCode: () => true }
    if (name.endsWith('/productDocumentVisibility')) return visibility
    if (name.endsWith('/productAuthorization')) return { requireProductPermission: async () => ({ product_code: 'P', actor_uid: 'u', revision: 3, status: productStatus }), checkProductPermission: async () => ({ allowed: editAllowed, facts: { product_code: 'P', actor_uid: 'u', revision: editRevision, status: productStatus } }) }
    if (name.endsWith('/aimsRuntimeForward')) return { runtimeEnvelopeError: () => createError({ statusCode: 503 }) }
    if (name.endsWith('/productDocumentCodocs')) return { readProductDocumentMetadata: async () => {
      if (errorCode) throw createError({ statusCode, data: { code: errorCode } })
      return { uuid, title: '说明', doc_type: 'product', updated_at: '2026-09-08' }
    } }
    if (name.endsWith('/tenantRuntimeClient')) return { maybeCallTenantRuntime: async (_event: unknown, path: string, options: any) => {
      calls.push({ path, options })
      return { handled: true, data: { code: 0, data: { product_code: 'P', workspace_revision: 3, page: 1, pageSize: 100, total: 1, items: [{ biz_id: uuid, document_uuid: uuid, product_code: 'P', purpose: 'design', revision: 1, removed: false }] } } }
    } }
    throw new Error(name)
  } })
  return { calls, run: () => exports.handleProductDocumentList({ method: 'GET' }) }
}
test('document BFF composes precise relation query and visible metadata', async () => {
  const h = harness()
  const result = await h.run()
  assert.equal(result.data.total, 1)
  assert.equal(result.data.items[0].metadata.title, '说明')
  assert.equal(h.calls[0].options.scope, 'aims.read aims:product-documents:read')
  assert.equal(h.calls[0].options.body.authorization.resource, 'product_documents')
  assert.equal(h.calls[0].options.query.current_user, 'u')
})
test('document BFF only filters explicit document ACL denial and inactivity', async () => {
  for (const code of ['permission_denied', 'product_document_inactive']) {
    const result = await harness(code).run()
    assert.equal(result.data.total, 0)
    assert.equal(result.data.restrictedCount, 1)
    assert.deepEqual(result.data.items, [])
  }
  for (const code of ['insufficient_scope', 'service_source_invalid', 'http_403']) await assert.rejects(harness(code).run(), { statusCode: 403 })
  await assert.rejects(harness('service_unavailable', 503).run(), { statusCode: 503 })
})

test('document edit affordance uses current independent edit permission and matching facts', async () => {
  assert.equal((await harness().run()).data.canEdit, true)
  assert.equal((await harness('', 403, false).run()).data.canEdit, false)
  assert.equal((await harness('', 403, true, 3, 'archived').run()).data.canEdit, false)
  await assert.rejects(harness('', 403, true, 4).run(), { statusCode: 409 })
})
