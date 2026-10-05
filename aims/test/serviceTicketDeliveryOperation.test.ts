import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  executeClaimedServiceTicketDeliveryOperation,
  type ClaimedDeliveryOperation,
  type ServiceTicketDeliveryOperationIO
} from '../server/utils/serviceTicketDeliveryOperationExecutor.ts'

const root = fileURLToPath(new URL('..', import.meta.url))

function source(path: string) {
  return readFileSync(`${root}/${path}`, 'utf8')
}

const operationId = '550e8400-e29b-41d4-a716-446655440000'
const receiptId = '660e8400-e29b-41d4-a716-446655440000'
const operationKey = 'aims:work-item:WI-1:ticket-result:g1:v1'

function claimedOperation(fencingToken = 1): ClaimedDeliveryOperation {
  return {
    operationId,
    operationKey,
    tenantCode: 'TENANT-A',
    deploymentCode: 'AIMS-DEPLOYMENT',
    sourceApp: 'aims',
    targetApp: 'altoc',
    operationCode: 'aims.work-item.ticket-result.v1',
    requiredCapability: 'altoc:service-ticket:delivery-result:sync',
    idempotencyKey: operationKey,
    commandSchemaVersion: 'v1',
    commandSha256: 'a'.repeat(64),
    fencingToken,
    command: {
      ticketCode: 'ST-1',
      workItemKey: 'WI-1',
      deliveryStatus: 'closed',
      idempotencyKey: operationKey
    }
  }
}

function succeededReceipt(idempotent = false) {
  return {
    receiptId,
    receiptStatus: 'succeeded',
    operationId,
    operationCode: 'aims.work-item.ticket-result.v1',
    idempotencyKey: operationKey,
    commandSchemaVersion: 'v1',
    commandSha256: 'a'.repeat(64),
    targetBizType: 'service_ticket',
    targetBizCode: 'ST-1',
    responseSummarySha256: 'b'.repeat(64),
    idempotent
  }
}

test('work item PUT dispatches the operation returned by runtime metadata', () => {
  const handler = source('server/api/v1/work-items/[id].put.ts')

  assert.match(handler, /dispatchServiceTicketDeliveryOperation/)
  assert.match(handler, /serviceTicketDelivery/)
  assert.match(handler, /operationKey/)
  assert.match(handler, /dispatchServiceTicketDeliveryOperation\(event,\s*operationKey,\s*uid\)/)
  assert.match(handler, /setResponseStatus\(event,\s*202\)/)
  assert.doesNotMatch(handler, /service-delivery-result:prepare/)
  assert.doesNotMatch(handler, /syncPreparedServiceTicketDelivery/)
})

test('delivery dispatcher claims frozen command and delegates to the shared executor', () => {
  const utilityPath = `${root}/server/utils/serviceTicketDeliveryOperation.ts`
  assert.ok(existsSync(utilityPath), 'serviceTicketDeliveryOperation utility is required')
  const utility = [
    readFileSync(utilityPath, 'utf8'),
    readFileSync(`${root}/server/utils/serviceTicketDeliveryOperationExecutor.ts`, 'utf8')
  ].join('\n')

  assert.match(utility, /export async function dispatchServiceTicketDeliveryOperation/)
  assert.match(utility, /integration-operations\/.*:claim/)
  assert.match(utility, /integration-operations\/.*:succeed/)
  assert.match(utility, /integration-operations\/.*:fail/)
  assert.match(utility, /delivery-result:sync/)
  assert.match(utility, /operation\.command|claimed\.command|commandJson/)
  assert.match(utility, /pending:\s*true/)

  assert.match(utility, /const operation = await io\.callRuntime<ClaimedDeliveryOperation \| null>\([\s\S]*:claim/)
  assert.match(utility, /return await executeClaimedServiceTicketDeliveryOperation\(operation, io, normalizedKey\)/)
  assert.match(utility, /export async function executeClaimedServiceTicketDeliveryOperation/)
  assert.match(utility, /io\.callAltoc\(buildServiceCommandEnvelope\(operation\), operationKey\)/)
  assert.match(utility, /validateServiceCommandReceipt\(operation, response/)
  assert.match(utility, /targetReceiptId: text\(result\.receiptId\)/)
  assert.match(utility, /receiptCommandSha256: text\(result\.commandSha256\)/)
  assert.match(utility, /fencingToken: operation\.fencingToken/)
})

test('delivery executor records a transient 503 and succeeds when the frozen operation is retried', async () => {
  const runtimeCalls: Array<{ path: string, body: Record<string, unknown> }> = []
  let downstreamAttempts = 0
  const io: ServiceTicketDeliveryOperationIO = {
    async callRuntime<T>(path: string, body: Record<string, unknown>) {
      runtimeCalls.push({ path, body })
      return { status: path.endsWith(':fail') ? 'retry_wait' : 'succeeded' } as T
    },
    async callAltoc() {
      downstreamAttempts += 1
      if (downstreamAttempts === 1) {
        throw Object.assign(new Error('temporary downstream outage'), {
          statusCode: 503,
          data: { error: { code: 'downstream_unavailable' } }
        })
      }
      return succeededReceipt(true)
    }
  }

  const failed = await executeClaimedServiceTicketDeliveryOperation(claimedOperation(1), io)
  assert.equal(failed.pending, true)
  assert.equal(failed.synced, false)
  assert.match(runtimeCalls[0]?.path || '', /:fail$/)
  assert.deepEqual(runtimeCalls[0]?.body, {
    operationId,
    fencingToken: 1,
    httpStatus: 503,
    timedOut: false,
    networkError: false,
    deliveryUncertain: false,
    errorCode: 'downstream_unavailable',
    errorSummary: 'temporary downstream outage'
  })

  const recovered = await executeClaimedServiceTicketDeliveryOperation(claimedOperation(2), io)
  assert.equal(recovered.pending, false)
  assert.equal(recovered.synced, true)
  assert.equal(recovered.result?.idempotent, true)
  assert.match(runtimeCalls[1]?.path || '', /:succeed$/)
  assert.equal(runtimeCalls[1]?.body.fencingToken, 2)
  assert.equal(runtimeCalls[1]?.body.targetReceiptId, receiptId)
  assert.equal(downstreamAttempts, 2)
})

test('delivery executor marks a timeout as delivery-uncertain partial recovery work', async () => {
  const runtimeCalls: Array<{ path: string, body: Record<string, unknown> }> = []
  const io: ServiceTicketDeliveryOperationIO = {
    async callRuntime<T>(path: string, body: Record<string, unknown>) {
      runtimeCalls.push({ path, body })
      return { status: 'partial_unknown' } as T
    },
    async callAltoc() {
      throw Object.assign(new Error('request timed out'), { code: 'ETIMEDOUT' })
    }
  }

  const result = await executeClaimedServiceTicketDeliveryOperation(claimedOperation(7), io)
  assert.equal(result.pending, true)
  assert.match(runtimeCalls[0]?.path || '', /:fail$/)
  assert.equal(runtimeCalls[0]?.body.httpStatus, 0)
  assert.equal(runtimeCalls[0]?.body.timedOut, true)
  assert.equal(runtimeCalls[0]?.body.networkError, true)
  assert.equal(runtimeCalls[0]?.body.deliveryUncertain, true)
  assert.equal(runtimeCalls[0]?.body.errorCode, 'ETIMEDOUT')
})

test('delivery executor returns recoverable pending when target committed but success checkpoint is unavailable', async () => {
  const runtimeCalls: string[] = []
  let downstreamAttempts = 0
  const io: ServiceTicketDeliveryOperationIO = {
    async callRuntime<_T>(path: string) {
      runtimeCalls.push(path)
      throw Object.assign(new Error('source checkpoint unavailable'), { statusCode: 503 })
    },
    async callAltoc() {
      downstreamAttempts += 1
      return succeededReceipt()
    }
  }

  const result = await executeClaimedServiceTicketDeliveryOperation(claimedOperation(9), io)

  assert.equal(result.synced, false)
  assert.equal(result.pending, true)
  assert.equal(result.errorCode, 'integration_checkpoint_unavailable')
  assert.equal(result.result?.receiptId, receiptId)
  assert.equal(downstreamAttempts, 1)
  assert.deepEqual(runtimeCalls, [
    `/v1/aims/integration-operations/${encodeURIComponent(operationKey)}:succeed`
  ])
})
