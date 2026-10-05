import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  executeClaimedMilestoneReceivableOperation
} from '../server/utils/milestoneReceivableOperationExecutor.ts'
import type {
  ClaimedDeliveryOperation,
  ServiceTicketDeliveryOperationIO
} from '../server/utils/serviceTicketDeliveryOperationExecutor.ts'

const root = fileURLToPath(new URL('..', import.meta.url))
const operationId = '550e8400-e29b-41d4-a716-446655440000'
const receiptId = '660e8400-e29b-41d4-a716-446655440000'
const operationKey = 'aims:milestone:PRJ-1:17:accepted:v1'

function claimed(fencingToken: number): ClaimedDeliveryOperation {
  return {
    operationId,
    operationKey,
    tenantCode: 'TENANT-1',
    deploymentCode: 'DEPLOYMENT-1',
    sourceApp: 'aims',
    targetApp: 'altoc',
    operationCode: 'aims.milestone.receivable-billable.v1',
    requiredCapability: 'altoc:receivable:mark-billable',
    idempotencyKey: operationKey,
    commandSchemaVersion: 'v1',
    commandSha256: 'a'.repeat(64),
    fencingToken,
    command: {
      milestoneId: 17,
      projectCode: 'PRJ-1',
      contractCode: 'CT-1',
      paymentTermId: 23,
      idempotencyKey: operationKey,
      operatorUid: 'u1'
    }
  }
}

function receipt(idempotent: boolean) {
  return {
    receiptId,
    receiptStatus: 'succeeded',
    operationId,
    operationCode: 'aims.milestone.receivable-billable.v1',
    idempotencyKey: operationKey,
    commandSchemaVersion: 'v1',
    commandSha256: 'a'.repeat(64),
    targetBizType: 'receivable_plan_set',
    targetBizCode: 'payment-term:23',
    responseSummarySha256: 'b'.repeat(64),
    idempotent
  }
}

test('Workflow callback dispatches only the operation frozen by milestone finalization', () => {
  const retired = readFileSync(`${root}/server/api/v1/milestones/[id]/review-approve.post.ts`, 'utf8')
  const route = readFileSync(`${root}/server/api/v1/service/workflow/callback.post.ts`, 'utf8')
  const source = readFileSync(`${root}/../data-runtime/internal/apps/aims/milestone_receivable_operation.go`, 'utf8')
  assert.match(retired, /statusCode: 410/)
  assert.match(route, /requireServiceScope/)
  assert.match(route, /workflow_callback_verified/)
  assert.match(route, /dispatchMilestoneReceivableOperation\(event, operationKey\)/)
  assert.doesNotMatch(route, /receivablePlanCode|paymentTermId|markReceivablePlanBillable/)
  assert.match(source, /paymentTermID\.Int64/)
  assert.doesNotMatch(source, /firstBodyText\(body,\s*"receivablePlanCode"|firstBodyText\(body,\s*"paymentTermId"/)
})

test('milestone executor checkpoints 503 and recovers with the same frozen identity', async () => {
  const runtime: Array<{ path: string, body: Record<string, unknown> }> = []
  let calls = 0
  const io: ServiceTicketDeliveryOperationIO = {
    async callRuntime<T>(path, body) {
      runtime.push({ path, body })
      return { status: path.endsWith(':fail') ? 'retry_wait' : 'succeeded' } as T
    },
    async callAltoc() { throw new Error('not used') },
    async callAltocReceivable() {
      calls += 1
      if (calls === 1) {
        throw Object.assign(new Error('Altoc temporarily unavailable'), {
          statusCode: 503,
          data: { error: { code: 'altoc_unavailable' } }
        })
      }
      return receipt(true)
    }
  }

  const failed = await executeClaimedMilestoneReceivableOperation(claimed(1), io)
  assert.equal(failed.pending, true)
  assert.match(runtime[0]?.path || '', /:fail$/)
  assert.equal(runtime[0]?.body.errorCode, 'altoc_unavailable')
  const recovered = await executeClaimedMilestoneReceivableOperation(claimed(2), io)
  assert.equal(recovered.synced, true)
  assert.equal(recovered.result?.idempotent, true)
  assert.equal(runtime[1]?.body.targetReceiptId, receiptId)
  assert.equal(runtime[1]?.body.fencingToken, 2)
})

test('target success with lost source ack is recovered by receipt replay', async () => {
  let checkpointAttempts = 0
  let downstreamCalls = 0
  const io: ServiceTicketDeliveryOperationIO = {
    async callRuntime<T>(path) {
      if (path.endsWith(':succeed')) {
        checkpointAttempts += 1
        if (checkpointAttempts === 1) throw Object.assign(new Error('source ack lost'), { code: 'ECONNRESET' })
      }
      return { status: 'succeeded' } as T
    },
    async callAltoc() { throw new Error('not used') },
    async callAltocReceivable() {
      downstreamCalls += 1
      return receipt(downstreamCalls > 1)
    }
  }

  await assert.rejects(() => executeClaimedMilestoneReceivableOperation(claimed(4), io), /source ack lost/)
  const recovered = await executeClaimedMilestoneReceivableOperation(claimed(5), io)
  assert.equal(recovered.synced, true)
  assert.equal(recovered.result?.idempotent, true)
  assert.equal(checkpointAttempts, 2)
})

test('service caller derives path from the nested frozen command and sends the full envelope', () => {
  const source = readFileSync(`${root}/server/utils/serviceTicketDeliveryOperation.ts`, 'utf8')
  assert.match(source, /objectBody\(objectBody\(envelope\.serviceCommand\)\.command\)/)
  assert.match(source, /body:\s*envelope/)
  assert.doesNotMatch(source, /body:\s*command/)
})
