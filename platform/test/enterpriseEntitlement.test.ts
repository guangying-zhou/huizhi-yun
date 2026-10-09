import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseEntitlementUtc, normalizeEnterprisePeriod, enterpriseStatusAt, restoreEnterpriseEntitlement, planEnterpriseEntitlementMigration, assertEntitlementMigrationPreconditions, type EntitlementMigrationInput } from '../server/utils/enterpriseEntitlement.ts'

const period = { effectiveFrom: '2026-01-01T00:00:00Z', end: { kind: 'finite' as const, effectiveUntil: '2027-01-01T00:00:00Z' } }
function input(): EntitlementMigrationInput {
  return { tenantCode: 'tenant-a', migrationId: 'migration-1', expectedRevision: 3, tenantStatus: 'active', now: '2026-09-13T00:00:00Z', sources: [{ id: 'subscription:1', status: 'active', period, evidenceReference: 'contract:1' }] }
}

test('UTC parsing rejects offsets, nonexistent dates and local time; accepts leap day', () => {
  for (const date of ['2026-02-30T00:00:00Z', '2026-01-01', '2026-01-01T00:00:00+00:00', '2026-01-01T24:00:00Z']) assert.throws(() => parseEntitlementUtc(date))
  assert.equal(parseEntitlementUtc('2024-02-29T00:00:00Z'), Date.UTC(2024, 1, 29))
  assert.equal(parseEntitlementUtc('2024-02-29T00:00:00.123Z'), Date.UTC(2024, 1, 29) + 123)
})
test('period is half-open and does not imply active for pending qualification', () => {
  assert.equal(enterpriseStatusAt({ ...period, status: 'active' }, period.effectiveFrom), 'active')
  assert.equal(enterpriseStatusAt({ ...period, status: 'active' }, period.end.effectiveUntil), 'expired')
  assert.equal(enterpriseStatusAt({ ...period, status: 'active' }, '2025-12-31T23:59:59.999Z'), 'pending')
  assert.equal(enterpriseStatusAt({ ...period, status: 'pending' }, '2026-09-13T00:00:00Z'), 'pending')
  assert.throws(() => normalizeEnterprisePeriod({ ...period, end: { kind: 'finite', effectiveUntil: period.effectiveFrom } }))
})
test('unlimited requires explicit evidence, missing period is review', () => {
  assert.throws(() => normalizeEnterprisePeriod({ effectiveFrom: period.effectiveFrom, end: { kind: 'unlimited', evidenceReference: '' } }))
  const i = input()
  i.sources[0]!.period = undefined
  assert.equal(planEnterpriseEntitlementMigration(i).decision, 'needs-review')
  i.sources[0]!.period = { effectiveFrom: period.effectiveFrom, end: { kind: 'unlimited', evidenceReference: 'perpetual-contract:1' } }
  assert.equal(planEnterpriseEntitlementMigration(i).decision, 'ready')
})
test('conversion preserves dates, revision, source identities and input', () => {
  const i = input()
  const original = JSON.stringify(i)
  const result = planEnterpriseEntitlementMigration(i)
  assert.equal(result.decision, 'ready')
  assert.equal(result.entitlement?.revision, 4)
  assert.deepEqual(result.entitlement?.end, { kind: 'finite', effectiveUntil: '2027-01-01T00:00:00.000Z' })
  assert.equal(result.entitlement?.effectiveFrom, '2026-01-01T00:00:00.000Z')
  assert.equal(result.entitlement?.productCode, 'enterprise-full')
  assert.equal(result.migrationId, i.migrationId)
  assert.equal(JSON.stringify(i), original)
})
test('mismatched periods require review unless evidenced enterprise authority resolves them', () => {
  const i = input()
  i.sources.push({ ...i.sources[0]!, id: 'license:1', period: { ...period, end: { kind: 'finite', effectiveUntil: '2028-01-01T00:00:00Z' } } })
  assert.ok(planEnterpriseEntitlementMigration(i).conflicts.includes('conflicting_periods'))
  i.sources[0]!.authoritativeEnterprisePeriod = true
  assert.equal(planEnterpriseEntitlementMigration(i).decision, 'ready')
  i.sources[0]!.evidenceReference = ''
  assert.equal(planEnterpriseEntitlementMigration(i).decision, 'needs-review')
})
test('conflicting status and duplicate authorities never silently win', () => {
  const i = input()
  i.sources.push({ ...i.sources[0]!, id: 'license:1', status: 'expired' })
  assert.equal(planEnterpriseEntitlementMigration(i).decision, 'needs-review')
  i.sources.forEach((s) => {
    s.authoritativeEnterprisePeriod = true
  })
  assert.ok(planEnterpriseEntitlementMigration(i).conflicts.includes('multiple_authoritative_periods'))
})
test('overall tenant suspension/revocation/expiry/pending takes precedence', () => {
  for (const status of ['suspended', 'revoked', 'expired', 'pending'] as const) {
    const i = input()
    i.tenantStatus = status
    assert.equal(planEnterpriseEntitlementMigration(i).entitlement?.status, status)
  }
})
test('restoration never extends expiry or recovers revoked qualification', () => {
  const grant = planEnterpriseEntitlementMigration(input()).entitlement!
  const restored = restoreEnterpriseEntitlement({ ...grant, status: 'suspended' }, '2028-01-01T00:00:00Z')
  assert.equal(restored.status, 'expired')
  assert.deepEqual(restored.end, grant.end)
  assert.throws(() => restoreEnterpriseEntitlement({ ...grant, status: 'revoked' }, input().now))
})
test('hash is order-stable and detects status, invalid date, evidence and tenant drift', () => {
  const i = input()
  i.sources.push({ ...i.sources[0]!, id: 'license:1' })
  const original = planEnterpriseEntitlementMigration(i)
  i.sources.reverse()
  assert.equal(planEnterpriseEntitlementMigration(i).sourceHash, original.sourceHash)
  for (const mutate of [(v: EntitlementMigrationInput) => {
    v.tenantCode = 'tenant-b'
  }, (v: EntitlementMigrationInput) => {
    v.sources[0]!.evidenceReference = 'other'
  }, (v: EntitlementMigrationInput) => {
    v.tenantStatus = 'suspended'
  }]) {
    const copy = structuredClone(i)
    mutate(copy)
    assert.notEqual(planEnterpriseEntitlementMigration(copy).sourceHash, original.sourceHash)
  }
  assertEntitlementMigrationPreconditions(original, { sourceHash: original.sourceHash, revision: 3 })
  assert.throws(() => assertEntitlementMigrationPreconditions(original, { sourceHash: original.sourceHash, revision: 4 }))
  assert.throws(() => assertEntitlementMigrationPreconditions(original, { sourceHash: 'different', revision: 3 }))
})
test('empty/duplicate sources and invalid migration identity are rejected', () => {
  const i = input()
  i.sources = []
  assert.equal(planEnterpriseEntitlementMigration(i).decision, 'needs-review')
  i.sources = [input().sources[0]!, input().sources[0]!]
  assert.throws(() => planEnterpriseEntitlementMigration(i))
  i.expectedRevision = -1
  assert.throws(() => planEnterpriseEntitlementMigration(i))
})
