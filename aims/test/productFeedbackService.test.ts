/* eslint-disable @typescript-eslint/no-explicit-any -- Controlled service boundary adapters. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { createError } from 'h3'
import { hashServiceCommandPayload } from '../../foundation/server/utils/tenantRuntimeClient'

const compiled = ts.transpileModule(readFileSync(new URL('../server/utils/productFeedbackService.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
async function run(mode = '') {
  const exports: any = {}, calls: string[] = []
  const id = '00000000-0000-4000-8000-000000000001'
  const command = { actorUid: 'original', productCode: 'P', ticketCode: 'ST-1', requestBizId: id, title: 'Feedback', description: '', action: 'create' }
  const envelope = { operationId: id, targetApp: 'aims', operationCode: 'altoc.aims.product-request.create-from-feedback.v1', requiredCapability: 'aims:product-request:create-from-feedback', commandSchemaVersion: 'product-feedback-create.v1', idempotencyKey: 'original-key', commandSha256: await hashServiceCommandPayload(command), command }
  if (mode === 'tamper') command.actorUid = 'other'
  runInNewContext(compiled, { exports, require: (name: string) => {
    if (name === 'h3') return { createError, setHeader: () => {}, getQuery: () => ({}), getHeader: () => 'Bearer token', getRequestURL: () => ({ pathname: '/api/v1/service/product-requests/from-feedback' }), readBody: async () => ({ serviceCommand: envelope }) }
    if (name === './productFeedbackServiceAuth') return { requireProductFeedbackServiceAuth: async () => ({ tenant: 'TENANT', sourceDeployment: 'ALTOC', targetDeployment: 'AIMS' }) }
    if (name === './productFeedbackAuthorization') return { requireProductFeedbackAuthorization: async (_: any, actor: string) => {
      calls.push('permission')
      assert.equal(actor, 'original')
      if (mode === 'denied') throw createError({ statusCode: 403 })
      return { allowed: true }
    } }
    if (name === './aimsRuntimeForward') return { runtimeEnvelopeError: () => createError({ statusCode: 503 }) }
    if (name.endsWith('/tenantRuntimeClient')) return { hashServiceCommandPayload, verifyServiceCommandRuntimeHeaders: async () => {
      calls.push('signature')
      if (mode === 'signature') throw createError({ statusCode: 403 })
    }, maybeCallTenantRuntime: async (_: any, path: string, options: any) => {
      calls.push(path.endsWith(':feedback-authorization') ? 'facts' : 'write')
      assert.equal(options.serviceCommandActor.uid, 'original')
      assert.equal(options.serviceTokenSourceBinding, 'service-client-policy')
      return { handled: true, data: { code: 0, data: path.endsWith(':feedback-authorization') ? {} : { ...envelope, receiptId: id, receiptStatus: 'succeeded', idempotent: false, targetBizType: 'product_request', targetBizCode: mode === 'receipt' ? 'wrong' : id, responseSummarySha256: 'a'.repeat(64), result: { biz_id: id, product_code: 'P' } } } }
    } }
    throw new Error(name)
  } })
  try {
    return { calls, result: await exports.handleProductFeedbackService({ method: 'POST' }) }
  } catch (error) {
    return { calls, error }
  }
}
test('feedback service verifies signature, authorizes original actor and returns filtered receipt', async () => {
  const { result, calls } = await run()
  assert.deepEqual(calls, ['signature', 'facts', 'permission', 'write'])
  assert.equal(result.data.result.product_code, 'P')
  assert.equal(result.data.command, undefined)
})
test('feedback service blocks tampered command and unauthorized writes and rejects wrong receipt', async () => {
  for (const mode of ['tamper', 'signature', 'denied', 'receipt']) {
    const { error, calls } = await run(mode)
    assert.equal((error as any)?.statusCode, mode === 'receipt' ? 503 : 403)
    if (mode !== 'receipt') assert.equal(calls.includes('write'), false)
  }
})
