import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  coverageFormalTargetFromBody,
  serviceAgreementCoverageReferenceIssue,
  serviceAgreementCoverageRuntimeErrorStatus
} from '../server/utils/serviceAgreementCoverageReferences.ts'

describe('service agreement coverage Assets validation', () => {
  test('derives formal pair target from delivery asset and environment codes', () => {
    assert.deepEqual(
      coverageFormalTargetFromBody({
        deliveryAssetCode: 'CDA-1',
        environmentCode: 'ENV-1'
      }),
      {
        targetType: 'delivery_asset_environment',
        deliveryAssetCode: 'CDA-1',
        environmentCode: 'ENV-1',
        requiresValidation: true
      }
    )
  })

  test('rejects unresolved formal pair before writing Altoc coverage', () => {
    const issue = serviceAgreementCoverageReferenceIssue(
      {
        targetType: 'delivery_asset_environment',
        deliveryAssetCode: 'CDA-1',
        environmentCode: 'ENV-1',
        requiresValidation: true
      },
      {
        delivery_assets: [{ code: 'CDA-1', found: true, item: { customer_code: 'CUS-1' } }],
        environments: [{ code: 'ENV-1', found: true, item: { customer_code: 'CUS-1' } }],
        pairs: [{ delivery_asset_code: 'CDA-1', environment_code: 'ENV-1', found: false }]
      },
      'CUS-1'
    )

    assert.equal(issue?.code, 'delivery_asset_environment_conflict')
    assert.equal(issue?.statusCode, 409)
  })

  test('rejects cross-customer formal asset references', () => {
    const issue = serviceAgreementCoverageReferenceIssue(
      {
        targetType: 'delivery_asset',
        deliveryAssetCode: 'CDA-1',
        environmentCode: '',
        requiresValidation: true
      },
      {
        delivery_assets: [{ code: 'CDA-1', found: true, item: { customer_code: 'CUS-2' } }]
      },
      'CUS-1'
    )

    assert.equal(issue?.code, 'delivery_asset_customer_conflict')
    assert.equal(issue?.statusCode, 409)
  })

  test('maps coverage runtime business errors to caller-visible statuses', () => {
    assert.equal(serviceAgreementCoverageRuntimeErrorStatus('coverage_target_conflict'), 409)
    assert.equal(serviceAgreementCoverageRuntimeErrorStatus('environment_not_found'), 404)
    assert.equal(serviceAgreementCoverageRuntimeErrorStatus('record_not_found'), 404)
    assert.equal(serviceAgreementCoverageRuntimeErrorStatus('invalid_coverage_status'), 400)
    assert.equal(serviceAgreementCoverageRuntimeErrorStatus('missing_delivery_asset_code'), 400)
    assert.equal(serviceAgreementCoverageRuntimeErrorStatus('invalid_environment_transition'), 409)
    assert.equal(serviceAgreementCoverageRuntimeErrorStatus('unexpected_runtime_failure'), 502)
  })

  test('keeps explicit runtime status when provided', () => {
    assert.equal(serviceAgreementCoverageRuntimeErrorStatus('coverage_target_conflict', 422), 422)
  })
})
