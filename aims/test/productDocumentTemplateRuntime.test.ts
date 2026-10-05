/* eslint-disable @typescript-eslint/no-explicit-any -- VM isolates service boundary adapters. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { createError } from 'h3'

const id = '00000000-0000-4000-8000-000000000001'
const compiled = ts.transpileModule(readFileSync(new URL('../server/utils/productDocumentTemplateRuntime.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
async function run(mode = '') {
  const exports: any = {}, calls: any[] = []
  let checks = 0
  runInNewContext(compiled, { exports, require: (name: string) => {
    if (name === 'h3') return { createError, getHeader: () => 'stable-key', getQuery: () => ({}), getRouterParam: () => 'P', setHeader: () => {}, readBody: async () => ({ templateUuid: id, title: 'Spec', purpose: 'design', expectedRevision: 1, ...(mode === 'injection' ? { actorUid: 'other' } : {}) }) }
    if (name.endsWith('/productDocumentDispatch')) return { dispatchProductDocumentRequest: async (_: any, request: string, product: string) => {
      calls.push({ dispatch: request, product })
      if (mode === 'dispatch-failure') throw new Error('unavailable')
      return { synced: true }
    } }
    if (name.endsWith('/productCrossDependencyInput')) return { crossDependencyProductCode: () => true }
    if (name.endsWith('/productWorkspaceInput')) return { productCommandKey: (key: string) => key }
    if (name.endsWith('/productAuthorization')) return { requireProductPermission: async () => ({ product_code: 'P', actor_uid: mode === 'drift' && ++checks > 1 ? 'other' : 'user', revision: 1 }) }
    if (name.endsWith('/productDocumentCodocs')) return { readProductDocumentMetadata: async () => {
      calls.push('acl')
      if (mode === 'denied') throw createError({ statusCode: 403 })
    } }
    if (name.endsWith('/tenantRuntimeClient')) return { maybeCallTenantRuntime: async (_: any, path: string, options: any) => {
      calls.push({ path, options })
      return { handled: true, data: { code: 0, data: { value: { product_code: mode === 'foreign' ? 'OTHER' : 'P', biz_id: id, document_uuid: id, operation_id: id, workspace_revision: 2 } } } }
    } }
    if (name.endsWith('/aimsRuntimeForward')) return { runtimeEnvelopeError: () => createError({ statusCode: 503 }) }
    throw new Error(name)
  } })
  try {
    return { calls, result: await exports.handleProductDocumentTemplateCreate({ method: 'POST' }) }
  } catch (error) {
    return { calls, error }
  }
}
test('template request checks ACL then submits stable identity and hides internal document identifiers', async () => {
  const { calls, result } = await run()
  assert.equal(calls[0], 'acl')
  assert.equal(calls[1].options.idempotencyKey, 'stable-key')
  assert.equal(calls[1].options.query.current_user, 'user')
  assert.equal(calls[1].options.scope, 'aims.write aims:product-documents:create')
  assert.equal(result.data.requestBizId, id)
  assert.equal(result.data.document_uuid, undefined)
})
test('template request rejects actor injection, denied template, identity drift and foreign receipt', async () => {
  for (const [mode, status] of [['injection', 400], ['denied', 403], ['drift', 409], ['foreign', 503]] as const) {
    const { error, calls } = await run(mode)
    assert.equal((error as any)?.statusCode, status)
    if (mode !== 'foreign') assert.equal(calls.some(call => call.path), false)
  }
})

test('accepted template request remains recoverable when immediate dispatch fails', async () => {
  const { result, calls } = await run('dispatch-failure')
  assert.equal(result.data.requestBizId, id)
  assert.equal(result.data.creationConfirmed, false)
  assert.equal(calls.at(-1).dispatch, id)
  const success = await run()
  assert.equal(success.result.data.creationConfirmed, true)
})
