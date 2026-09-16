/* eslint-disable @typescript-eslint/no-explicit-any -- VM adapters validate frozen command and receipt boundaries. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { createError } from 'h3'
import * as service from '../../foundation/server/utils/serviceOperation'
import { hashServiceCommandPayload } from '../../foundation/server/utils/tenantRuntimeClient'

const compiled = ts.transpileModule(readFileSync(new URL('../server/utils/productCostRulesOperationExecutor.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
async function run(mode = '') {
  const exports: any = {}, calls: any[] = []
  const command = { actorUid: 'original-user', projectCode: 'PRJ', periodMonth: '2026-09', expectedRevision: 2, evidenceRef: 'review', shares: [{ productCode: 'P', basisPoints: 5000 }] }
  const operation = { operationId: '00000000-0000-4000-8000-000000000003', operationKey: 'key', idempotencyKey: 'key', tenantCode: 'TENANT', deploymentCode: 'AIMS', sourceApp: 'aims', targetApp: 'finance', operationCode: 'aims.finance.product-cost.rules.replace.v1', requiredCapability: 'finance:product-cost:replace-rules', commandSchemaVersion: 'product-cost-rules.v1', commandSha256: await hashServiceCommandPayload(command), fencingToken: 2, command }
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
    if (name === './productCostRulesOperationExecutor') return exports
    return {}
  } })
  const result = await dispatcher.executeClaimedAimsOperation(operation, {
    callFinanceProductCostRules: mode === 'missing-transport'
      ? undefined
      : async (body: any) => {
        calls.push({ target: body })
        return { ...body.serviceCommand, receiptId: '00000000-0000-4000-8000-000000000004', receiptStatus: 'succeeded', targetBizType: 'product_cost_attribution_revision', targetBizCode: mode === 'wrong-receipt' ? 'other' : 'PRJ:2026-09:3', responseSummarySha256: 'a'.repeat(64), result: { projectCode: 'PRJ', periodMonth: '2026-09', revision: mode === 'wrong-revision' ? 4 : 3 } }
      },
    callRuntime: async (path: string, body: any) => {
      calls.push({ path, body })
      if (mode === 'lost-ack' && path.endsWith(':succeed')) throw new Error('unavailable')
      return { accepted: true }
    }
  })
  return { result, calls }
}
test('cost rules executor preserves frozen actor and checkpoints receipt under lease', async () => {
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

test('cost rules executor rejects receipt with a different result revision', async () => {
  const { calls } = await run('wrong-revision')
  assert.equal(calls.at(-1).path.endsWith(':fail'), true)
})
