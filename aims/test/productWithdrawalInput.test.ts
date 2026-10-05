import assert from 'node:assert/strict'
import test from 'node:test'
import { productWithdrawalInput } from '../server/utils/productWithdrawalInput.ts'

const cycle = '00000000-0000-4000-8000-000000000001', item = '00000000-0000-4000-8000-000000000002'
const valid = { expectedRevision: 1, expectedCycleRevision: 2, expectedItemRevision: 3, expectedQueueRevision: 4, reason: '延后范围', impactNote: '保留历史决定', exceptions: [] }
test('withdrawal binds paths and requires four revisions, impact and explicit exceptions', () => {
  assert.equal(productWithdrawalInput(valid, cycle, item)?.item_biz_id, item)
  for (const patch of [{ expectedItemRevision: 0 }, { expectedQueueRevision: undefined }, { impactNote: '' }, { exceptions: null }, { itemId: cycle }, { consumedEffort: '0' }, { assessmentId: 1 }]) assert.equal(productWithdrawalInput({ ...valid, ...patch }, cycle, item), null)
  assert.equal(productWithdrawalInput(valid, cycle, 'bad'), null)
})

test('withdrawal carries only an explicit canonical consumption confirmation reference', () => {
  assert.equal(productWithdrawalInput({ ...valid, consumptionConfirmationId: cycle }, cycle, item)?.consumption_confirmation_id, cycle)
  assert.equal('consumption_confirmation_id' in productWithdrawalInput(valid, cycle, item)!, false)
  for (const value of [null, '', 123, {}, cycle.toUpperCase().replace('00000000', 'ABCDEF00'), 'bad']) assert.equal(productWithdrawalInput({ ...valid, consumptionConfirmationId: value }, cycle, item), null)
  for (const patch of [{ spentPersonDays: '0.00' }, { confirmedBy: 'pm' }, { pendingConsumption: {} }]) assert.equal(productWithdrawalInput({ ...valid, consumptionConfirmationId: cycle, ...patch }, cycle, item), null)
})
