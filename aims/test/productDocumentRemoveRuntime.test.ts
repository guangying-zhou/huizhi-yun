/* eslint-disable @typescript-eslint/no-explicit-any -- Controlled VM boundary adapters. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { createError } from 'h3'
import { productCommandKey } from '../server/utils/productWorkspaceInput'

const compiled = ts.transpileModule(readFileSync(new URL('../server/utils/productDocumentRemoveRuntime.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
function harness(patch: object = {}, denied = false, purpose = false, restore?: string, create = false) {
  const calls: any[] = [], exports: any = {}
  runInNewContext(compiled, { exports, require: (name: string) => {
    if (name.endsWith('/productDocumentCodocs')) return { readProductDocumentMetadata: async (_event: unknown, code: string, uuid: string) => {
      calls.push({ metadata: uuid, code })
      if (restore === 'denied') throw createError({ statusCode: 403 })
      return {}
    } }
    if (name === 'h3') return { createError, setHeader: () => {}, getRouterParam: () => 'P', getQuery: () => ({}), getHeader: () => 'document-remove-key-1', readBody: async () => {
      calls.push('body')
      return create ? { documentUuid: '00000000-0000-4000-8000-000000000002', purpose: 'design', expectedRevision: 1, ...patch } : { bizId: '00000000-0000-4000-8000-000000000001', expectedRevision: 1, expectedDocumentRevision: 1, ...patch }
    } }
    if (name.endsWith('/productAuthorization')) return { requireProductPermission: async (_: unknown, code: string, resource: string, action: string) => {
      calls.push({ code, resource, action })
      if (denied) throw createError({ statusCode: 403 })
      return { product_code: 'P', actor_uid: 'session-user', revision: 2 }
    } }
    if (name.endsWith('/productWorkspaceInput')) return { productCommandKey }
    if (name.endsWith('/productCrossDependencyInput')) return { crossDependencyProductCode: () => true }
    if (name.endsWith('/aimsRuntimeForward')) return { runtimeEnvelopeError: () => createError({ statusCode: 409 }) }
    if (name.endsWith('/tenantRuntimeClient')) return { maybeCallTenantRuntime: async (_: unknown, path: string, options: any) => {
      calls.push({ path, options })
      if (path.endsWith('/documents:view')) return { handled: true, data: { code: 0, data: { product_code: 'P', workspace_revision: 2, item: { product_code: restore === 'foreign' ? 'OTHER' : 'P', biz_id: '00000000-0000-4000-8000-000000000001', document_uuid: '00000000-0000-4000-8000-000000000002', removed: false } } } }
      return { handled: true, data: { code: 0, data: { replayed: true } } }
    } }
    throw new Error(name)
  } })
  return { calls, run: () => (create ? exports.handleProductDocumentCreate : restore !== undefined ? exports.handleProductDocumentRestore : purpose ? exports.handleProductDocumentPurpose : exports.handleProductDocumentRemove)({ method: 'POST' }) }
}
test('remove BFF binds edit actor and stable key while allowing old-revision receipt replay', async () => {
  const h = harness()
  const result = await h.run()
  assert.equal(result.data.replayed, true)
  assert.equal(h.calls[0].resource, 'product_documents')
  assert.equal(h.calls[0].action, 'edit')
  const call = h.calls[2]
  assert.equal(call.options.scope, 'aims.write aims:product-documents:remove')
  assert.equal(call.options.idempotencyKey, 'document-remove-key-1')
  assert.equal(call.options.query.current_user, 'session-user')
  assert.equal(call.options.body.input.expected_revision, 1)
  assert.equal(call.options.body.authorization.facts.revision, 2)
})
test('remove BFF denies before body and rejects actor injection and invalid revisions', async () => {
  const denied = harness({}, true)
  await assert.rejects(denied.run(), { statusCode: 403 })
  assert.equal(denied.calls.length, 1)
  for (const patch of [{ actorUid: 'other' }, { expectedRevision: '1' }, { expectedDocumentRevision: 0 }, { bizId: 'invalid' }]) {
    const h = harness(patch)
    await assert.rejects(h.run(), { statusCode: 400 })
    assert.equal(h.calls.length, 2)
  }
})

test('purpose BFF uses exact edit capability and rejects unknown or injected fields', async () => {
  const h = harness({ purpose: 'user-guide' }, false, true)
  await h.run()
  assert.equal(h.calls[2].options.scope, 'aims.write aims:product-documents:edit')
  assert.equal(h.calls[2].options.body.input.purpose, 'user-guide')
  assert.ok(h.calls[2].path.endsWith('/documents:edit'))
  for (const patch of [{}, { purpose: 'unknown' }, { purpose: 1 }, { purpose: 'design', actorUid: 'other' }]) {
    const invalid = harness(patch, false, true)
    await assert.rejects(invalid.run(), { statusCode: 400 })
    assert.equal(invalid.calls.length, 2)
  }
  await assert.rejects(harness({ purpose: 'design' }, true, true).run(), { statusCode: 403 })
})

test('restore derives document UUID from the relation and checks current Codocs ACL before mutation', async () => {
  const h = harness({}, false, false, '')
  await h.run()
  const reads = h.calls.filter(call => call?.path)
  assert.equal(reads.length, 2)
  assert.ok(reads[0].path.endsWith('/documents:view'))
  assert.ok(reads[1].path.endsWith('/documents:restore'))
  assert.equal(reads[1].options.scope, 'aims.write aims:product-documents:restore')
  assert.equal(h.calls.find(call => call?.metadata)?.metadata, '00000000-0000-4000-8000-000000000002')
  for (const failure of ['foreign', 'denied']) {
    const invalid = harness({}, false, false, failure)
    await assert.rejects(invalid.run(), { statusCode: failure === 'foreign' ? 503 : 403 })
    assert.equal(invalid.calls.filter(call => call?.path?.endsWith('/documents:restore')).length, 0)
  }
})

test('create checks Codocs access before writing and rejects browser actor injection', async () => {
  const h = harness({}, false, false, undefined, true)
  await h.run()
  assert.equal(h.calls[2].metadata, '00000000-0000-4000-8000-000000000002')
  assert.ok(h.calls[3].path.endsWith('/documents:create'))
  assert.equal(h.calls[3].options.scope, 'aims.write aims:product-documents:create')
  assert.equal(h.calls[3].options.body.input.document_uuid, h.calls[2].metadata)
  const denied = harness({}, false, false, 'denied', true)
  await assert.rejects(denied.run(), { statusCode: 403 })
  assert.equal(denied.calls.filter(call => call?.path).length, 0)
  for (const patch of [{ actorUid: 'other' }, { documentUuid: 'invalid' }, { purpose: 'unknown' }, { expectedRevision: 0 }]) {
    const invalid = harness(patch, false, false, undefined, true)
    await assert.rejects(invalid.run(), { statusCode: 400 })
    assert.equal(invalid.calls.length, 2)
  }
})
