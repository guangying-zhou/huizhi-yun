import { test } from 'node:test'
import assert from 'node:assert/strict'
import { productOnboardInput } from '../server/utils/productOnboardInput.ts'

const raw = { productCode: 'P-1', managerUid: 'pm', reason: '接入产品规划' }
test('onboarding requires an explicit manager and only maps business fields', () => {
  assert.deepEqual(productOnboardInput(raw), { productCode: 'P-1', input: { manager_uid: 'pm', reason: raw.reason, positioning: null, target_users: null, value_statement: null } })
  for (const patch of [{ managerUid: '' }, { managerUid: ' pm' }, { productCode: 'a/b' }, { productCode: ['P-1'] }, { reason: '' }, { authorization: {} }, { source: {} }, { directory: {} }, { positioning: 12 }, { positioning: 'a'.repeat(10001) }]) {
    assert.equal(productOnboardInput({ ...raw, ...patch }), null)
  }
})
