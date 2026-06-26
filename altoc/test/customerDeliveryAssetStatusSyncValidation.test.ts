import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { deliveryAssetStatusSyncFormalTarget } from '../server/utils/customerDeliveryAssetStatusSyncReferences.ts'
import { serviceAgreementCoverageReferenceIssue } from '../server/utils/serviceAgreementCoverageReferences.ts'

describe('customer delivery asset status sync formal target', () => {
  test('does not treat an Altoc plan code path as a formal delivery asset code', () => {
    const { target, issue } = deliveryAssetStatusSyncFormalTarget('DAP-1', {
      sourcePlanCode: 'DAP-1'
    })

    assert.equal(issue, null)
    assert.deepEqual(target, {
      targetType: '',
      deliveryAssetCode: '',
      environmentCode: '',
      requiresValidation: false
    })
  })

  test('rejects explicit plan code as formal delivery asset code', () => {
    const { issue } = deliveryAssetStatusSyncFormalTarget('DAP-1', {
      deliveryAssetCode: 'CDAP-CL-1'
    })

    assert.equal(issue?.code, 'invalid_delivery_asset_code')
    assert.equal(issue?.statusCode, 400)
  })

  test('requires Assets validation for formal asset and environment pair', () => {
    const { target, issue } = deliveryAssetStatusSyncFormalTarget('CDA-1', {
      environmentCode: 'ENV-1'
    })

    assert.equal(issue, null)
    assert.deepEqual(target, {
      targetType: 'delivery_asset_environment',
      deliveryAssetCode: 'CDA-1',
      environmentCode: 'ENV-1',
      requiresValidation: true
    })
  })

  test('rejects formal pair that belongs to another customer during status sync', () => {
    const { target, issue } = deliveryAssetStatusSyncFormalTarget('CDA-2', {
      sourcePlanCode: 'DAP-1',
      environmentCode: 'ENV-2'
    })
    assert.equal(issue, null)

    const referenceIssue = serviceAgreementCoverageReferenceIssue(
      target,
      {
        delivery_assets: [{ code: 'CDA-2', found: true, item: { customer_code: 'CUS-B' } }],
        environments: [{ code: 'ENV-2', found: true, item: { customer_code: 'CUS-B' } }],
        pairs: [{ delivery_asset_code: 'CDA-2', environment_code: 'ENV-2', found: true }]
      },
      'CUS-A'
    )

    assert.equal(referenceIssue?.code, 'delivery_asset_customer_conflict')
    assert.equal(referenceIssue?.statusCode, 409)
  })
})
