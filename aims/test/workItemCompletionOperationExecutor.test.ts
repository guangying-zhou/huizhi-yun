/* eslint-disable @typescript-eslint/no-explicit-any -- VM boundary adapters exercise real command/receipt helpers. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { createError } from 'h3'
import * as service from '../../foundation/server/utils/serviceOperation'
import { hashServiceCommandPayload } from '../../foundation/server/utils/tenantRuntimeClient'

const compiled = ts.transpileModule(readFileSync(new URL('../server/utils/workItemCompletionOperationExecutor.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
async function run(mode = '') {
  const exports: any = {}, calls: any[] = []
  const key = 'aims:work-item-completion:3:workflow-submit:v1'
  const command: any = { completionRequestId: 3, workItemId: 9, workItemKey: 'P-9', projectId: 2, actorUid: 'U1', snapshotSha256: 'b'.repeat(64), bizTitle: '完成目标', bizContext: { project_id: 2 }, formData: { completionRequestId: 3, workItemId: 9, projectId: 2, snapshotSha256: 'b'.repeat(64) }, idempotencyKey: key }
  const operation: any = { operationId: '00000000-0000-4000-8000-000000000003', operationKey: key, idempotencyKey: key, tenantCode: 'TENANT', deploymentCode: 'AIMS', sourceApp: 'aims', targetApp: 'workflow', operationCode: 'aims.work-item.completion.workflow-submit.v1', requiredCapability: 'workflow:work-item-complete:create', commandSchemaVersion: 'v1', commandSha256: await hashServiceCommandPayload(command), originalActorUid: 'U1', fencingToken: 2, command }
  if (mode === 'tamper') command.formData.projectId = 4
  if (mode === 'actor') operation.originalActorUid = 'U2'
  if (mode === 'tenant') operation.tenantCode = ''
  if (mode === 'source') operation.sourceApp = 'enterprise'
  if (mode === 'capability') operation.requiredCapability = 'workflow:write'
  if (mode === 'extra') command.callbackUrl = 'https://untrusted.invalid'
  runInNewContext(compiled, { exports, require: (name: string) => {
    if (name === 'h3') return { createError }
    if (name.endsWith('/serviceOperation')) return service
    if (name.endsWith('/tenantRuntimeClient')) return { hashServiceCommandPayload }
    throw new Error(name)
  } })
  const dispatcher: any = {}
  const dispatcherCode = ts.transpileModule(readFileSync(new URL('../server/utils/claimedAimsOperationExecutor.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
  runInNewContext(dispatcherCode, { exports: dispatcher, require: (name: string) => name === './workItemCompletionOperationExecutor' ? exports : {} })
  const result = await dispatcher.executeClaimedAimsOperation(operation, {
    callWorkflowWorkItemCompletion: mode === 'missing-transport' ? undefined : async (body: any) => {
      calls.push({ target: body })
      if (mode === 'timeout') throw Object.assign(new Error('timeout'), { name: 'TimeoutError' })
      return { ...body.serviceCommand, receiptId: '00000000-0000-4000-8000-000000000004', receiptStatus: 'succeeded', targetBizType: 'work_item_completion_workflow', targetBizCode: mode === 'wrong-receipt' ? 'other' : 'completion-request:3', responseSummarySha256: 'a'.repeat(64), result: { instance: { instance_id: mode === 'missing-instance' ? 0 : 71, instance_no: 'WF71' } } }
    },
    callRuntime: async (path: string, body: any) => {
      calls.push({ path, body })
      if (mode === 'lost-ack' && path.endsWith(':succeed')) throw new Error('unavailable')
      return { accepted: true }
    }
  })
  return { result, calls }
}
test('shared completion executor dispatches immutable request and checkpoints receipt plus actual Workflow instance', async () => {
  const { result, calls } = await run()
  assert.equal(result.synced, true)
  assert.equal(calls[0].target.serviceCommand.command.formData.completionRequestId, 3)
  assert.equal(calls[1].body.fencingToken, 2)
  assert.equal(calls[1].body.workflowInstanceId, 71)
  assert.equal(calls[1].body.workflowInstanceNo, 'WF71')
})
test('tampering, actor/source/capability and nested project drift cannot reach Workflow', async () => {
  for (const mode of ['tamper', 'actor', 'tenant', 'source', 'capability', 'extra']) {
    const { calls } = await run(mode)
    assert.equal(calls.some(call => call.target), false, mode)
    assert.equal(calls.at(-1).path.endsWith(':fail'), true)
  }
})
test('wrong receipt or missing instance cannot ACK; lost ACK remains pending without marking delivery failed', async () => {
  for (const mode of ['wrong-receipt', 'missing-instance']) assert.equal((await run(mode)).calls.at(-1).path.endsWith(':fail'), true)
  const lost = await run('lost-ack')
  assert.equal(lost.result.errorCode, 'integration_checkpoint_unavailable')
  assert.equal(lost.calls.some(call => call.path?.endsWith(':fail')), false)
})
test('missing Workflow transport is retryable and makes no external call', async () => {
  const { calls } = await run('missing-transport')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].body.httpStatus, 503)
  assert.equal(calls[0].body.deliveryUncertain, false)
})
