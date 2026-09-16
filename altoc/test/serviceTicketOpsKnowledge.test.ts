import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import {
  existingOpsKnowledgeDocument,
  resolveServiceTicketOpsKnowledgeContext,
  serviceTicketOpsKnowledgeIdempotencyKey
} from '../server/utils/serviceTicketOpsKnowledge.ts'

describe('service ticket ops knowledge trusted context', () => {
  test('derives all cross-app identifiers from dispatch context', () => {
    const result = resolveServiceTicketOpsKnowledgeContext('ST-1', 'DOC-1', {
      customer_code: 'CU-1',
      contract_code: 'CT-1',
      maintenance_contract_code: 'MC-1',
      aims_project_code: 'PRJ-1',
      resolved_delivery_code: 'DLV-1',
      delivery_asset_code: 'CDA-1',
      environment_code: 'ENV-1'
    })
    assert.deepEqual(result.missing, [])
    assert.deepEqual(result.context, {
      ticketCode: 'ST-1',
      documentUuid: 'DOC-1',
      customerCode: 'CU-1',
      contractCode: 'CT-1',
      maintenanceContractCode: 'MC-1',
      projectCode: 'PRJ-1',
      deliveryCode: 'DLV-1',
      deliveryAssetCode: 'CDA-1',
      environmentCode: 'ENV-1'
    })
  })

  test('fails closed when formal asset or environment is absent', () => {
    const result = resolveServiceTicketOpsKnowledgeContext('ST-1', 'DOC-1', {
      customer_code: 'CU-1',
      contract_code: 'CT-1',
      project_code: 'PRJ-1',
      delivery_code: 'DLV-1'
    })
    assert.deepEqual(result.missing, ['deliveryAssetCode', 'environmentCode'])
  })

  test('uses stable idempotency and existing UUID projection', () => {
    assert.equal(serviceTicketOpsKnowledgeIdempotencyKey('ST-1', 'DOC-1'), 'altoc:ticket:ST-1:ops-knowledge:DOC-1')
    assert.equal(existingOpsKnowledgeDocument({ codocs_document_uuid: 'DOC-1' }), 'DOC-1')
  })

  test('reserves and checkpoints each frozen operation before advancing to the dependent write', () => {
    const source = readFileSync(new URL('../server/api/v1/service-tickets/[ticketCode]/ops-knowledge.post.ts', import.meta.url), 'utf8')
    const executor = readFileSync(new URL('../server/utils/serviceTicketOpsKnowledgeOperation.ts', import.meta.url), 'utf8')
    const reservation = source.indexOf('/ops-knowledge:reserve')
    const codocsClaim = source.indexOf('claimOpsKnowledgeOperation(operationIO, codocsOperationKey)')
    const codocsExecute = source.indexOf('executeClaimedOpsKnowledgeOperation(codocsClaim, operationIO)')
    const assetsClaim = source.indexOf('claimOpsKnowledgeOperation(operationIO, assetsOperationKey)')
    const assetsExecute = source.indexOf('executeClaimedOpsKnowledgeOperation(assetsClaim, operationIO)')
    assert.ok(reservation > 0 && reservation < codocsClaim && codocsClaim < codocsExecute && codocsExecute < assetsClaim && assetsClaim < assetsExecute)
    assert.match(source, /resolveServiceTicketOpsKnowledgeContext\(ticketCode, documentUuid, ticket\)/)
    assert.match(source, /requestedIdempotencyKey && requestedIdempotencyKey !== idempotencyKey/)
    assert.match(source, /serviceTicketOpsKnowledgeIdempotencyKey\(ticketCode, documentUuid\)/)
    assert.match(source, /return acceptedOperationResponse\(event, ticketCode, documentUuid, idempotencyKey, reservation,/)
    assert.match(executor, /\/api\/v1\/service\/ops-knowledge\/link/)
    assert.match(executor, /\/api\/v1\/service\/deliveries\/.*\/documents/)
    assert.match(executor, /\/ops-knowledge:complete/)
    assert.match(executor, /operation\.command/)
    assert.match(executor, /buildServiceCommandEnvelope\(operation\)/)
    assert.match(executor, /validateServiceCommandReceipt\(operation, response/)
    assert.match(executor, /targetReceiptId: text\(receipt\.receiptId\)/)
    assert.match(executor, /receiptCommandSha256: text\(receipt\.commandSha256\)/)
    assert.doesNotMatch(source, /request\.(customer|contract|project|deliveryAsset|environment)/)
  })
})
