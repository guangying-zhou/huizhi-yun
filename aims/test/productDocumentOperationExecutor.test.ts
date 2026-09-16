/* eslint-disable @typescript-eslint/no-explicit-any -- VM adapters validate frozen command and receipt boundaries. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { createError } from 'h3'
import * as service from '../../foundation/server/utils/serviceOperation'
import { hashServiceCommandPayload } from '../../foundation/server/utils/tenantRuntimeClient'

const compiled = ts.transpileModule(readFileSync(new URL('../server/utils/productDocumentOperationExecutor.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
async function run(mode = '') {
  const exports: any = {}, calls: any[] = []
  const command = { actorUid: 'original-user', productCode: 'P', documentUuid: '00000000-0000-4000-8000-000000000001', templateUuid: '00000000-0000-4000-8000-000000000002', title: 'Spec', action: 'create' }
  const operation = { operationId: '00000000-0000-4000-8000-000000000003', operationKey: 'key', idempotencyKey: 'key', tenantCode: 'TENANT', deploymentCode: 'AIMS', sourceApp: 'aims', targetApp: 'codocs', operationCode: 'aims.codocs.product-document.create.v1', requiredCapability: 'codocs:product-document:create', commandSchemaVersion: 'product-document-create.v1', commandSha256: await hashServiceCommandPayload(command), fencingToken: 2, command }
  if (mode === 'tamper') command.actorUid = 'other'
  runInNewContext(compiled, { exports, require: (name: string) => {
    if (name === 'h3') return { createError }
    if (name.endsWith('/serviceOperation')) return service
    if (name.endsWith('/tenantRuntimeClient')) return { hashServiceCommandPayload }
    throw new Error(name)
  } })
  const dispatcher: any = {}
  const dispatcherCode = ts.transpileModule(readFileSync(new URL('../server/utils/claimedAimsOperationExecutor.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
  runInNewContext(dispatcherCode, { exports: dispatcher, require: (name: string) => {
    if (name === './productDocumentOperationExecutor') return exports
    return {}
  } })
  const result = await dispatcher.executeClaimedAimsOperation(operation, {
    callCodocsProductDocument: mode === 'missing-transport'
      ? undefined
      : async (body: any) => {
        calls.push({ target: body })
        return { ...body.serviceCommand, receiptId: '00000000-0000-4000-8000-000000000004', receiptStatus: 'succeeded', targetBizType: 'product_document', targetBizCode: mode === 'wrong-receipt' ? 'other' : command.documentUuid, responseSummarySha256: 'a'.repeat(64), result: { uuid: command.documentUuid, productCode: 'P', title: 'Spec' } }
      },
    callRuntime: async (path: string, body: any) => {
      calls.push({ path, body })
      if (mode === 'lost-ack' && path.endsWith(':succeed')) throw new Error('unavailable')
      return { accepted: true }
    }
  })
  return { result, calls }
}
test('product creation executor preserves frozen actor and checkpoints receipt under lease', async () => {
  const { result, calls } = await run()
  assert.equal(result.synced, true)
  assert.equal(calls[0].target.serviceCommand.command.actorUid, 'original-user')
  assert.equal(calls[1].body.fencingToken, 2)
  assert.equal(calls[1].body.targetReceiptId, '00000000-0000-4000-8000-000000000004')
})
test('tampered command and wrong receipt cannot succeed; lost ACK remains pending', async () => {
  const tampered = await run('tamper')
  assert.equal(tampered.calls.some(call => call.target), false)
  const wrong = await run('wrong-receipt')
  assert.equal(wrong.calls.at(-1).path.endsWith(':fail'), true)
  const lost = await run('lost-ack')
  assert.equal(lost.result.errorCode, 'integration_checkpoint_unavailable')
  assert.equal(lost.calls.some(call => call.path?.endsWith(':fail')), false)
})

test('shared dispatcher checkpoints missing product transport as retryable without external delivery', async () => {
  const { result, calls } = await run('missing-transport')
  assert.equal(result.pending, true)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].path.endsWith(':fail'), true)
  assert.equal(calls[0].body.httpStatus, 503)
  assert.equal(calls[0].body.deliveryUncertain, false)
})
