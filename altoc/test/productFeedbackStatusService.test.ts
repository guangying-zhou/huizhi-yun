import { productFeedbackRuntimeError } from '../server/utils/productFeedbackRuntimeError'
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { createError } from 'h3'
import { hashServiceCommandPayload } from '../../foundation/server/utils/tenantRuntimeClient'

const compiled = ts.transpileModule(readFileSync(new URL('../server/utils/productFeedbackStatusService.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
async function run(mode = '') {
  const exports: any = {}, calls: string[] = []
  const id = '00000000-0000-4000-8000-000000000001'
  const command = { productCode: 'P', ticketCode: 'ST-1', requestBizId: id, canonicalRequestBizId: id, decisionStatus: 'accepted', sourceRevision: 3 }
  const envelope = { operationId: id, targetApp: 'altoc', operationCode: 'aims.altoc.product-feedback.update-status.v1', requiredCapability: 'altoc:product-feedback:update-status', commandSchemaVersion: 'product-feedback-status.v1', idempotencyKey: 'original-key', commandSha256: await hashServiceCommandPayload(command), command }
  if (mode === 'tamper') command.sourceRevision = 4
  runInNewContext(compiled, { exports, require: (name: string) => {
    if (name === './productFeedbackRuntimeError') return { productFeedbackRuntimeError }
    if (name === 'h3') return { createError, setHeader: () => {}, getQuery: () => ({}), getHeader: () => 'Bearer token', getRequestURL: () => ({ pathname: '/api/v1/service/product-feedback/status' }), readBody: async () => ({ serviceCommand: envelope }) }
    if (name === './productFeedbackStatusAuth') return { requireProductFeedbackStatusAuth: async () => ({ tenant: 'TENANT', sourceDeployment: 'AIMS', targetDeployment: 'ALTOC' }) }
    if (name.endsWith('/tenantRuntimeClient')) return { hashServiceCommandPayload, verifyServiceCommandRuntimeHeaders: async () => {
      calls.push('signature')
      if (mode === 'signature') throw createError({ statusCode: 403 })
    }, maybeCallTenantRuntime: async (_: any, path: string, options: any) => {
      calls.push('write')
      if (mode === 'revision-conflict') return { handled: true, data: { code: 1, data: { upstreamStatus: 409, error: { code: 'feedback_progress_revision_conflict' } } } }
      assert.equal(path, '/v1/altoc/internal/product-feedback:status')
      assert.equal(options.serviceTokenSourceBinding, 'service-client-policy')
      return { handled: true, data: { code: 0, data: { ...envelope, receiptId: id, receiptStatus: 'succeeded', idempotent: false, targetBizType: 'product_feedback', targetBizCode: mode === 'receipt' ? 'wrong' : id, responseSummarySha256: 'a'.repeat(64), result: { requestBizId: id, sourceRevision: command.sourceRevision, applied: true } } } }
    } }
    throw new Error(name)
  } })
  try {
    return { calls, result: await exports.handleProductFeedbackStatusService({ method: 'POST' }) }
  } catch (error) {
    return { calls, error }
  }
}
test('feedback service verifies signature, returns filtered receipt', async () => {
  const { result, calls } = await run()
  assert.deepEqual(calls, ['signature', 'write'])
  assert.equal(result.data.result.sourceRevision, 3)
  assert.equal(result.data.command, undefined)
})
test('feedback service blocks tampered command and unsigned writes and rejects wrong receipt', async () => {
  for (const mode of ['tamper', 'signature', 'receipt']) {
    const { error, calls } = await run(mode)
    assert.equal((error as any)?.statusCode, mode === 'receipt' ? 503 : 403)
    if (mode !== 'receipt') assert.equal(calls.includes('write'), false)
  }
})

test('feedback service preserves runtime revision conflict', async () => {
  const { error, calls } = await run('revision-conflict')
  assert.equal((error as any)?.statusCode, 409)
  assert.deepEqual(calls, ['signature', 'write'])
})
