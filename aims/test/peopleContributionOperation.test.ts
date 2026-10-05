import assert from 'node:assert/strict'
import test from 'node:test'
import {
  executeClaimedPeopleContributionOperation
} from '../server/utils/peopleContributionOperationExecutor.ts'
import type {
  ClaimedDeliveryOperation,
  ServiceTicketDeliveryOperationIO
} from '../server/utils/serviceTicketDeliveryOperationExecutor.ts'

const operationId = '550e8400-e29b-41d4-a716-446655440001'
const operationKey = `aims:people-contributions:${'a'.repeat(64)}:r2`

function operation(fencingToken: number): ClaimedDeliveryOperation {
  return {
    operationId,
    operationKey,
    tenantCode: 'TENANT-A',
    deploymentCode: 'AIMS-DEPLOYMENT',
    sourceApp: 'aims',
    targetApp: 'people',
    operationCode: 'aims.people-contributions.replace-scope.v1',
    requiredCapability: 'people:write',
    idempotencyKey: operationKey,
    commandSchemaVersion: 'v1',
    commandSha256: 'b'.repeat(64),
    fencingToken,
    command: {
      cycle_code: 'CYCLE-1',
      project_code: 'PROJECT-1',
      source_revision: 2,
      snapshot_hash: 'c'.repeat(64),
      items: []
    }
  }
}

function receipt(idempotent: boolean, staleSkipped = false) {
  return {
    receiptId: '660e8400-e29b-41d4-a716-446655440001',
    receiptStatus: 'succeeded',
    operationId,
    operationCode: 'aims.people-contributions.replace-scope.v1',
    idempotencyKey: operationKey,
    commandSchemaVersion: 'v1',
    commandSha256: 'b'.repeat(64),
    targetBizType: 'performance_contribution_scope',
    targetBizCode: 'CYCLE-1:PROJECT-1',
    responseSummarySha256: 'd'.repeat(64),
    idempotent,
    result: { staleSkipped }
  }
}

test('People contribution executor records 5xx and later accepts an idempotent receipt', async () => {
  const checkpoints: string[] = []
  let attempts = 0
  const io: ServiceTicketDeliveryOperationIO = {
    async callRuntime<T>(path: string) {
      checkpoints.push(path)
      return { status: path.endsWith(':fail') ? 'retry_wait' : 'succeeded' } as T
    },
    async callAltoc() {
      throw new Error('unused')
    },
    async callPeople() {
      attempts += 1
      if (attempts === 1) {
        throw Object.assign(new Error('People unavailable'), { statusCode: 503 })
      }
      return receipt(true)
    }
  }

  const failed = await executeClaimedPeopleContributionOperation(operation(1), io)
  const recovered = await executeClaimedPeopleContributionOperation(operation(2), io)

  assert.equal(failed.pending, true)
  assert.equal(recovered.synced, true)
  assert.match(checkpoints[0] || '', /:fail$/)
  assert.match(checkpoints[1] || '', /:succeed$/)
})

test('People contribution executor safely retries after acknowledgement loss', async () => {
  let succeedCheckpoints = 0
  let receipts = 0
  const io: ServiceTicketDeliveryOperationIO = {
    async callRuntime<T>(path: string) {
      if (path.endsWith(':succeed')) {
        succeedCheckpoints += 1
        if (succeedCheckpoints === 1) throw Object.assign(new Error('checkpoint acknowledgement lost'), { code: 'ECONNRESET' })
        return { status: 'succeeded' } as T
      }
      return { status: 'partial_unknown' } as T
    },
    async callAltoc() {
      throw new Error('unused')
    },
    async callPeople() {
      receipts += 1
      return receipt(receipts > 1, true)
    }
  }

  const uncertain = await executeClaimedPeopleContributionOperation(operation(1), io)
  const recovered = await executeClaimedPeopleContributionOperation(operation(2), io)

  assert.equal(uncertain.pending, true)
  assert.equal(recovered.synced, true)
  assert.equal(recovered.staleSkipped, true)
  assert.equal(receipts, 2)
})
