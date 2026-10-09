import { test } from 'node:test'
import assert from 'node:assert/strict'
import { productConsumptionInput } from '../server/utils/productConsumptionInput.ts'

const cycle = '00000000-0000-4000-8000-000000000001', item = '00000000-0000-4000-8000-000000000002'
const valid = { expectedRevision: 1, expectedCycleRevision: 2, expectedItemRevision: 3, expectedQueueRevision: 4, expectedScopeRevision: 5, spentPersonDays: '12.34', reason: '评审后确认' }
test('consumption input binds path IDs and required exact fields', () => {
  const result = productConsumptionInput(valid, cycle, item)
  assert.equal(result?.cycle_biz_id, cycle)
  assert.equal(result?.item_biz_id, item)
  assert.equal(result?.spent_person_days, '12.34')
  assert.equal(result?.expected_scope_revision, 5)
  for (const patch of [{ expectedQueueRevision: undefined }, { expectedScopeRevision: 0 }, { reason: '' }, { actor: 'admin' }]) assert.equal(productConsumptionInput({ ...valid, ...patch }, cycle, item), null)
})

test('consumption input rejects extra keys and malformed decimal', () => {
  assert.equal(productConsumptionInput({ ...valid, spentPersonDays: '0.5' } as const, cycle, item)?.spent_person_days, '0.50')
  for (const patch of [{ spentPersonDays: '0.004' }, { spentPersonDays: '1000000.01' }, { spentPersonDays: '1000000.001' }, { spentPersonDays: 12.34 }, { spentPersonDays: 'bad' }, { spentPersonDays: '0.50', actor: 'hack' }]) assert.equal(productConsumptionInput({ ...valid, ...patch }, cycle, item), null)
  assert.equal(productConsumptionInput({ ...valid, spentPersonDays: 0 } as Record<string, unknown>, cycle, item), null)
  assert.equal(productConsumptionInput({ ...valid, expectedScopeRevision: 1 }, cycle, 'bad-id'), null)
})

test('consumption requires explicit known amount including zero and sub-half-day actuals', () => {
  for (const [raw, expected] of [['0', '0.00'], ['0.01', '0.01'], ['0.49', '0.49'], ['1000000', '1000000.00']]) assert.equal(productConsumptionInput({ ...valid, spentPersonDays: raw }, cycle, item)?.spent_person_days, expected)
  for (const amount of [undefined, null, '', '-0.01', '1e2', ' 1 ']) assert.equal(productConsumptionInput({ ...valid, spentPersonDays: amount }, cycle, item), null)
})
