import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { deliveryAssetStatusSyncFormalTarget } from '../server/utils/customerDeliveryAssetStatusSyncReferences.ts'

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
})
