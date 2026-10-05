import assert from 'node:assert/strict'
import test from 'node:test'
import { withdrawalConsumption } from '../app/utils/productWithdrawalConsumption.ts'
const cycleId = '00000000-0000-4000-8000-000000000001', itemId = '00000000-0000-4000-8000-000000000002'
const expected = { cycleId, itemId, workspaceRevision: 4, cycleRevision: 3, queueRevision: 3, itemRevision: 1, scopeRevision: 1, lifecycle: 'in_delivery' }
const pending = { confirmation_id: cycleId, cycle_biz_id: cycleId, item_biz_id: itemId, item_revision: 1, scope_revision: 1, spent_person_days: '3.25', confirmed_by: 'engineer', confirmed_at: '2026-09-08T12:00:00Z', reason: '核验投入' }
const view = { cycle_biz_id: cycleId, item_biz_id: itemId, workspace_revision: 4, cycle_revision: 3, queue_revision: 3, item_revision: 1, scope_revision: 1, lifecycle: 'in_delivery', selection_status: 'selected', current: true, pending }
test('withdrawal UI binds confirmation to exact current cycle scope and versions', () => {
  assert.equal(withdrawalConsumption(view, expected), pending)
  for (const patch of [{ current: false }, { pending: null }, { selection_status: 'deferred' }, { queue_revision: 4 }, { workspace_revision: 5 }, { scope_revision: 2 }]) assert.throws(() => withdrawalConsumption({ ...view, ...patch }, expected))
  for (const patch of [{ spent_person_days: 'unknown' }, { item_biz_id: cycleId }, { scope_revision: 2 }, { confirmation_id: 'bad' }]) assert.throws(() => withdrawalConsumption({ ...view, pending: { ...pending, ...patch } }, expected))
  assert.equal(withdrawalConsumption({ ...view, pending: null, lifecycle: 'proposed' }, { ...expected, lifecycle: 'proposed' }), null)
})
