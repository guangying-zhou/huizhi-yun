import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeEnterpriseApprovedOrder } from '../server/utils/enterpriseOrderApproval.ts'
import { requireEnterpriseEntitlementStateAccess } from '../server/utils/enterpriseEntitlementStateAccess.ts'

const approved = { tenantCode: 't1', requestId: 'q1', approvalReference: 'CONTRACT-1', effectiveFrom: '2026-09-01T00:00:00Z', effectiveUntil: '2027-03-15T00:00:00Z', amount: '120.5', currency: 'CNY', actorUid: 'ops-1' }
test('approved quotation preserves exact period and decimal amount', () => {
  const value = normalizeEnterpriseApprovedOrder(approved)
  assert.equal(value.amount, '120.50')
  assert.equal(value.effectiveUntil, '2027-03-15T00:00:00.000Z')
  for (const amount of ['-1', '1e2', '0.001', '10000000000', '01']) assert.throws(() => normalizeEnterpriseApprovedOrder({ ...approved, amount }), /amount_invalid/)
  assert.throws(() => normalizeEnterpriseApprovedOrder({ ...approved, effectiveUntil: '2026-08-01T00:00:00Z' }))
  assert.throws(() => normalizeEnterpriseApprovedOrder({ ...approved, approvalReference: '' }))
  assert.throws(() => normalizeEnterpriseApprovedOrder({ ...approved, effectiveFrom: '2026-09-01T00:00:00.001Z' }), /second_precision/)
})
test('only authenticated explicit subscription admin may approve quotation', async () => {
  await assert.rejects(requireEnterpriseEntitlementStateAccess({ platformUid: 'u', platformAccessScope: 'tenant-admin' }, async () => ({ resources: { 'ops.subscriptions': ['admin'] } })), /operations scope/)
  await assert.rejects(requireEnterpriseEntitlementStateAccess({ platformUid: 'u', platformAccessScope: 'ops' }, async () => ({ resources: { 'ops.subscriptions': ['edit'] } })), /admin permission/)
  assert.equal(await requireEnterpriseEntitlementStateAccess({ platformUid: 'u', platformAccessScope: 'ops' }, async () => ({ resources: { 'ops.subscriptions': ['admin'] } })), 'u')
})
