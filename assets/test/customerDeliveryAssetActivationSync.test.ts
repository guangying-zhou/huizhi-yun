import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { buildCustomerDeliveryAssetStatusSyncPayload } from '../server/utils/customerDeliveryAssetActivationSync.ts'

describe('customer delivery asset activation Altoc sync payload', () => {
  test('includes formal identity, environment, project and occurrence fields', () => {
    const payload = buildCustomerDeliveryAssetStatusSyncPayload({
      pathDeliveryAssetCode: 'CDA-PATH',
      asset: {
        delivery_asset_code: 'CDA-1',
        source_plan_code: 'DAP-1',
        contract_code: 'CON-1',
        contract_line_code: 'CL-1',
        environment_code: 'ENV-1',
        project_code: 'PRJ-1',
        status: 'accepted',
        accepted_at: '2026-07-01 10:00:00'
      },
      body: {
        current_user: 'u-1'
      }
    })

    assert.equal(payload.deliveryAssetCode, 'CDA-1')
    assert.equal(payload.externalAssetCode, 'CDA-1')
    assert.equal(payload.sourcePlanCode, 'DAP-1')
    assert.equal(payload.contractCode, 'CON-1')
    assert.equal(payload.contractLineCode, 'CL-1')
    assert.equal(payload.environmentCode, 'ENV-1')
    assert.equal(payload.projectCode, 'PRJ-1')
    assert.equal(payload.status, 'accepted')
    assert.equal(payload.occurredAt, '2026-07-01 10:00:00')
    assert.equal(payload.operatorUid, 'u-1')
  })

  test('uses explicit body values when runtime asset snapshot lacks them', () => {
    const payload = buildCustomerDeliveryAssetStatusSyncPayload({
      pathDeliveryAssetCode: 'CDA-1',
      asset: {},
      body: {
        sourcePlanCode: 'DAP-1',
        environmentCode: 'ENV-1',
        projectCode: 'PRJ-1',
        goLiveAt: '2026-07-01 09:00:00',
        status: 'online'
      }
    })

    assert.equal(payload.deliveryAssetCode, 'CDA-1')
    assert.equal(payload.sourcePlanCode, 'DAP-1')
    assert.equal(payload.environmentCode, 'ENV-1')
    assert.equal(payload.projectCode, 'PRJ-1')
    assert.equal(payload.occurredAt, '2026-07-01 09:00:00')
    assert.equal(payload.status, 'online')
  })
})
