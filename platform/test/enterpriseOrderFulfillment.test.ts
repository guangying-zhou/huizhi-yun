import { test } from 'node:test'
import assert from 'node:assert/strict'
import { entitlementPeriodForConfirmedOrder } from '../server/utils/enterpriseOrderFulfillment.ts'
import type { EnterpriseEntitlement, EnterprisePeriod } from '../server/utils/enterpriseEntitlement.ts'

const now = '2026-09-13T00:00:00Z'
const old: EnterpriseEntitlement = { schemaVersion: 'enterprise-entitlement.v1', productCode: 'enterprise-full', tenantCode: 't1', revision: 1, status: 'active', effectiveFrom: '2026-01-01T00:00:00.000Z', end: { kind: 'finite', effectiveUntil: '2027-01-01T00:00:00.000Z' } }
const renewal: EnterprisePeriod = { effectiveFrom: '2027-01-01T00:00:00Z', end: { kind: 'finite', effectiveUntil: '2027-06-01T00:00:00Z' } }
test('new order period is copied without trial or calendar-year arithmetic', () => {
  assert.deepEqual(entitlementPeriodForConfirmedOrder(null, renewal, now), { effectiveFrom: '2027-01-01T00:00:00.000Z', end: { kind: 'finite', effectiveUntil: '2027-06-01T00:00:00.000Z' } })
})
test('continuous renewal preserves original coverage and uses exact approved end', () => {
  assert.deepEqual(entitlementPeriodForConfirmedOrder(old, renewal, now), { effectiveFrom: old.effectiveFrom, end: { kind: 'finite', effectiveUntil: '2027-06-01T00:00:00.000Z' } })
})
test('active entitlement cannot bridge a future gap or shrink existing coverage', () => {
  assert.throws(() => entitlementPeriodForConfirmedOrder(old, { ...renewal, effectiveFrom: '2027-02-01T00:00:00Z' }, now), /period_gap/)
  assert.throws(() => entitlementPeriodForConfirmedOrder(old, { effectiveFrom: '2026-02-01T00:00:00Z', end: { kind: 'finite', effectiveUntil: '2026-10-01T00:00:00Z' } }, now), /does_not_extend/)
})
test('expired prior grant does not fill an unpurchased gap', () => {
  const late = { ...renewal, effectiveFrom: '2027-02-01T00:00:00Z' }
  assert.equal(entitlementPeriodForConfirmedOrder({ ...old, status: 'expired' }, late, '2027-02-01T00:00:00Z').effectiveFrom, '2027-02-01T00:00:00.000Z')
})
