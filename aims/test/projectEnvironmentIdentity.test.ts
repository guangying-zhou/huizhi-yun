import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildAssetsEnvironmentUpsertPayload,
  environmentUpsertStatusValue,
  normalizeProjectEnvironmentDeliveryStatus,
  normalizeProjectEnvironmentRelationType,
  projectEnvironmentIdempotencyKey
} from '../server/utils/projectEnvironmentIdentity.ts'

describe('project environment identity helpers', () => {
  test('defaults new environments to planning', () => {
    assert.equal(environmentUpsertStatusValue({}), 'planning')
  })

  test('does not roll back an existing formal environment without explicit status', () => {
    assert.equal(environmentUpsertStatusValue({ requestedEnvironmentCode: 'ENV-001' }), undefined)
  })

  test('passes through explicit lifecycle status', () => {
    assert.equal(
      environmentUpsertStatusValue({
        requestedEnvironmentCode: 'ENV-001',
        requestedEnvironmentStatus: 'active'
      }),
      'active'
    )
  })

  test('builds a stable retry key from the formal project/environment/asset relation', () => {
    assert.equal(
      projectEnvironmentIdempotencyKey({
        projectCode: 'PRJ-001',
        body: {
          environmentName: '生产环境',
          deliveryAssetCode: 'CDA-001',
          relationType: 'upgrade'
        }
      }),
      'aims:project-environment:PRJ-001:生产环境:CDA-001:upgrade'
    )
  })

  test('keeps caller idempotency key for recovery after Aims write failure', () => {
    assert.equal(
      projectEnvironmentIdempotencyKey({
        explicitIdempotencyKey: 'REQ-001',
        projectCode: 'PRJ-001',
        body: {
          environmentName: '生产环境',
          deliveryAssetCode: 'CDA-001',
          relationType: 'upgrade'
        }
      }),
      'REQ-001'
    )
  })

  test('normalizes invalid relation type without inventing another project relation namespace', () => {
    assert.equal(normalizeProjectEnvironmentRelationType('maintenance'), 'maintenance')
    assert.equal(normalizeProjectEnvironmentRelationType('bad-value'), 'initial_delivery')
  })

  test('rejects invalid project environment delivery status before cross-app writes', () => {
    assert.equal(normalizeProjectEnvironmentDeliveryStatus('online'), 'online')
    assert.equal(normalizeProjectEnvironmentDeliveryStatus('onlien'), '')
  })

  test('builds Assets upsert payload for a new formal environment without fake code', () => {
    assert.deepEqual(
      buildAssetsEnvironmentUpsertPayload({
        body: {
          environmentName: '生产环境',
          environmentType: 'customer_prod',
          deploymentMode: 'private',
          region: 'cn-east'
        },
        idempotencyKey: 'REQ-001',
        customerCode: 'CUS-001',
        contractCode: 'CON-001',
        projectCode: 'PRJ-001',
        operatorUid: 'u001'
      }),
      {
        environmentCode: undefined,
        idempotencyKey: 'REQ-001',
        customerCode: 'CUS-001',
        contractCode: 'CON-001',
        sourceProjectCode: 'PRJ-001',
        environmentName: '生产环境',
        environmentType: 'customer_prod',
        status: 'planning',
        deploymentMode: 'private',
        region: 'cn-east',
        description: undefined,
        operatorUid: 'u001'
      }
    )
  })

  test('builds Assets upsert payload for an existing formal environment without rollback status', () => {
    assert.deepEqual(
      buildAssetsEnvironmentUpsertPayload({
        body: {
          environmentCode: 'ENV-001'
        },
        requestedEnvironmentCode: 'ENV-001',
        idempotencyKey: 'REQ-002',
        customerCode: 'CUS-001',
        projectCode: 'PRJ-001',
        operatorUid: 'u001'
      }),
      {
        environmentCode: 'ENV-001',
        idempotencyKey: 'REQ-002',
        customerCode: 'CUS-001',
        contractCode: undefined,
        sourceProjectCode: 'PRJ-001',
        environmentName: undefined,
        environmentType: 'customer_prod',
        status: undefined,
        deploymentMode: undefined,
        region: undefined,
        description: undefined,
        operatorUid: 'u001'
      }
    )
  })
})
