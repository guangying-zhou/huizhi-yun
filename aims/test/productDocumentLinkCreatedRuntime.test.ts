/* eslint-disable @typescript-eslint/no-explicit-any -- VM isolates service boundary adapters. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { createError } from 'h3'

const id = '00000000-0000-4000-8000-000000000001'
const compiled = ts.transpileModule(readFileSync(new URL('../server/utils/productDocumentLinkCreatedRuntime.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
async function run(mode = '') {
  const exports: any = {}, calls: any[] = []
  let checks = 0
  runInNewContext(compiled, { exports, require: (name: string) => {
    if (name === 'h3') return { createError, getHeader: () => 'stable-key', getQuery: () => ({}), getRouterParam: () => 'P', setHeader: () => {}, readBody: async () => ({ requestBizId: id, expectedRevision: 1, ...(mode === 'injection' ? { actorUid: 'other' } : {}) }) }
    if (name.endsWith('/productCrossDependencyInput')) return { crossDependencyProductCode: () => true }
    if (name.endsWith('/productWorkspaceInput')) return { productCommandKey: (key: string) => key }
    if (name.endsWith('/productAuthorization')) return { requireProductPermission: async () => ({ product_code: 'P', actor_uid: mode === 'drift' && ++checks > 1 ? 'other' : 'user', revision: 1 }) }
    if (name.endsWith('/productDocumentCodocs')) return { readProductDocumentMetadata: async () => {
      calls.push('acl')
      if (mode === 'denied') throw createError({ statusCode: 403 })
    } }
    if (name.endsWith('/tenantRuntimeClient')) return { maybeCallTenantRuntime: async (_: any, path: string, options: any) => {
      calls.push({ path, options })
      if (path.endsWith(':request-view')) return { handled: true, data: { code: 0, data: { product_code: mode === 'foreign' ? 'OTHER' : 'P', biz_id: id, document_uuid: id, workspace_revision: 1, status: mode === 'pending' ? 'pending' : 'succeeded' } } }
      return { handled: true, data: { code: 0, data: { value: { product_code: mode === 'foreign' ? 'OTHER' : 'P', biz_id: id, document_uuid: id, operation_id: id, workspace_revision: 2 } } } }
    } }
    if (name.endsWith('/aimsRuntimeForward')) return { runtimeEnvelopeError: () => createError({ statusCode: 503 }) }
    throw new Error(name)
  } })
  try {
    return { calls, result: await exports.handleProductDocumentLinkCreated({ method: 'POST' }) }
  } catch (error) {
    return { calls, error }
  }
}
test('created document link resolves server UUID, checks ACL and writes with stable key', async () => {
  const { calls, result } = await run()
  assert.equal(calls[0].options.scope, 'aims.read aims:product-documents:read')
  assert.equal(calls[1], 'acl')
  assert.equal(calls[2].options.idempotencyKey, 'stable-key')
  assert.equal(calls[2].options.query.current_user, 'user')
  assert.equal(calls[2].options.body.input.request_biz_id, id)
  assert.equal(result.data.bizId, id)
})
test('link refuses injection, denied document, identity drift, foreign request and pending creation', async () => {
  for (const [mode, status] of [['injection', 400], ['denied', 403], ['drift', 409], ['foreign', 503], ['pending', 409]] as const) {
    const { error, calls } = await run(mode)
    assert.equal((error as any)?.statusCode, status)
    assert.equal(calls.some(call => call.path?.endsWith(':link-created')), false)
    if (['foreign', 'pending'].includes(mode)) assert.equal(calls.includes('acl'), false)
  }
})
