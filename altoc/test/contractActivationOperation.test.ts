import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import { executeClaimedContractActivationOperation, expectedContractActivationOperationsSucceeded, selectContractActivationProjectForLine } from '../server/utils/contractActivationOperation.ts'

const sha = 'a'.repeat(64)

function operation(operationCode = 'altoc.contract-activation.aims-project.v1') {
  return {
    operationId: '123e4567-e89b-42d3-a456-426614174000',
    operationKey: 'altoc:contract:ct-1:activation:coj-1:v1:plan:delivery-main:project',
    tenantCode: 'tenant-1', deploymentCode: 'deployment-1', sourceApp: 'altoc', targetApp: 'aims',
    operationCode, requiredCapability: 'aims:write', idempotencyKey: 'altoc:contract:ct-1:activation:coj-1:v1:plan:delivery-main:project',
    commandSchemaVersion: 'v1', commandSha256: sha, fencingToken: 2,
    command: { contractCode: 'CT-1', projectCode: 'PRJ-CT-1', planKey: 'delivery-main' }
  }
}

describe('contract activation reliable executor', () => {
  test('uses the fixed Aims project route and checkpoints exact receipt evidence', async () => {
    const calls: Array<Record<string, unknown>> = []
    const value = operation()
    const result = await executeClaimedContractActivationOperation(value, {
      async callRuntime(path, body) {
        calls.push({ kind: 'runtime', path, body })
        return { status: 'succeeded' } as never
      },
      async callService(appCode, scope, path, body, idempotencyKey) {
        calls.push({ kind: 'service', appCode, scope, path, body, idempotencyKey })
        return {
          receiptId: '123e4567-e89b-42d3-a456-426614174001', receiptStatus: 'succeeded',
          operationId: value.operationId, operationCode: value.operationCode, idempotencyKey: value.idempotencyKey,
          commandSchemaVersion: 'v1', commandSha256: sha, targetBizType: 'project', targetBizCode: 'PRJ-CT-1',
          responseSummarySha256: 'b'.repeat(64), idempotent: false, result: { project: { project_code: 'PRJ-CT-1' } }
        } as never
      }
    })
    assert.equal(result.succeeded, true)
    assert.equal(calls[0]?.appCode, 'aims')
    assert.equal(calls[0]?.scope, 'aims:write')
    assert.equal(calls[0]?.path, '/api/v1/service/projects/from-contract')
    assert.match(String(calls[1]?.path), /:succeed$/)
    assert.equal((calls[1]?.body as Record<string, unknown>).targetReceiptId, '123e4567-e89b-42d3-a456-426614174001')
  })

  test('rejects caller-selected target or capability before a target call', async () => {
    const value = { ...operation(), targetApp: 'finance' }
    let serviceCalls = 0
    const result = await executeClaimedContractActivationOperation(value, {
      async callRuntime() { return { status: 'failed_permanent' } as never },
      async callService() {
        serviceCalls++
        return {} as never
      }
    })
    assert.equal(result.succeeded, false)
    assert.equal(serviceCalls, 0)
  })

  test('keeps delivery assets bound to their own project plan', () => {
    const projects = [
      { projectCode: 'PRJ-A', projectRole: 'delivery', lineCodes: ['LINE-A'] },
      { projectCode: 'PRJ-B', projectRole: 'maintenance', lineCodes: ['LINE-B'] }
    ]
    assert.equal(selectContractActivationProjectForLine('LINE-B', projects).projectCode, 'PRJ-B')
    assert.equal(selectContractActivationProjectForLine('LINE-A', projects).projectCode, 'PRJ-A')
  })

  test('keeps downstream Assets blocked when expected milestones are missing or pending', () => {
    const code = 'altoc.contract-activation.aims-milestones.v1'
    assert.equal(expectedContractActivationOperationsSucceeded(true, code, []), false)
    assert.equal(expectedContractActivationOperationsSucceeded(true, code, [{ operationCode: code, succeeded: false }]), false)
    assert.equal(expectedContractActivationOperationsSucceeded(true, code, [{ operationCode: code, succeeded: true }]), true)
  })

  test('source freezes one project and dependent milestone operation per plan', () => {
    const source = readFileSync(new URL('../../data-runtime/internal/apps/altoc/contract_activation_operations.go', import.meta.url), 'utf8')
    const target = readFileSync(new URL('../../data-runtime/internal/apps/aims/service_contract_receipts.go', import.meta.url), 'utf8')
    assert.match(source, /for index, plan := range plans/)
    assert.match(source, /projectOperationKey/)
    assert.match(source, /milestoneOperationKey/)
    assert.match(source, /projectOperationKey, index\*10\+2/)
    assert.match(source, /TrustedContextFromMap\(body, "altoc"\)/)
    assert.match(source, /ValidateAndDigestCommand\(command\)/)
    assert.doesNotMatch(source, /"createdBy": operator/)
    assert.doesNotMatch(source, /body.*targetApp|body.*requiredCapability/)
    assert.match(target, /NewReceiptRepository/)
    assert.match(target, /createProjectFromContractTx/)
    assert.match(target, /syncPaymentMilestonesTx/)
  })
})
