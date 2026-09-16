import test from 'node:test'
import assert from 'node:assert/strict'
import { parseProductAdoptionResponse } from '../server/utils/productAdoptionResponse.ts'

const fixture = () => ({ productCode: 'PROD', queriedAt: '2026-09-09T12:00:00Z', page: 1, pageSize: 20, total: 1,
  summary: { instances: 1, environments: 1, customers: 1, productionInstances: 1, unknownVersionInstances: 1, conflictingVersionInstances: 1 },
  items: [{ deliveryAssetCode: 'DA1', environmentCode: 'ENV1', customerCode: 'CU1', roles: ['production', 'backup'], deploymentStatuses: ['online'], versions: ['v1', 'v2'], adopted: true, production: true, versionUnknown: true, versionConflict: true, internal: 'not returned' }], internal: 'not returned' })

test('adoption DTO preserves unknown and conflicting evidence while dropping internal fields', () => {
  const result = parseProductAdoptionResponse(fixture(), 'PROD', 1, 20)
  assert.ok(result)
  assert.equal(result.items[0]?.versionUnknown, true)
  assert.equal(result.items[0]?.versionConflict, true)
  assert.ok(!JSON.stringify(result).includes('internal'))
})
test('adoption DTO rejects inconsistent counts, duplicate instances and false version flags', () => {
  for (const mutate of [
    (data: ReturnType<typeof fixture>) => { data.summary.instances = 0 },
    (data: ReturnType<typeof fixture>) => { data.items[0]!.versionConflict = false },
    (data: ReturnType<typeof fixture>) => { data.items[0]!.adopted = false },
    (data: ReturnType<typeof fixture>) => { data.items[0]!.versions = ['v1', 'v1'] },
    (data: ReturnType<typeof fixture>) => { data.items[0]!.deploymentStatuses = ['future'] },
    (data: ReturnType<typeof fixture>) => {
      data.items.push(data.items[0]!)
      data.total = 2
    },
    (data: ReturnType<typeof fixture>) => { data.queriedAt = 'invalid' }
  ]) {
    const data = fixture()
    mutate(data)
    assert.equal(parseProductAdoptionResponse(data, 'PROD', 1, 20), null)
  }
})
