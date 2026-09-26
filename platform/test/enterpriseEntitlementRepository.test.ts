import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildEnterpriseEntitlementPreviewReport, createEnterpriseEntitlementRepository, type EnterpriseTransaction } from '../server/utils/enterpriseEntitlementRepository.ts'

function fixture() {
  const statements: string[] = []
  let revision = 0
  let receipt: { request_hash: unknown, result_json: unknown } | null = null
  let failReceipt = false
  let until = '2027-01-01 00:00:00'
  const transaction: EnterpriseTransaction = async (work) => {
    const oldRevision = revision
    const oldReceipt = receipt
    const tx = {
      async queryRow(sql: string) {
        statements.push(sql)
        if (sql.includes('FROM tenants ')) return { tenant_code: 't1', status: 'active' }
        if (sql.includes('FROM tenant_enterprise_entitlement_current')) return revision ? { revision } : null
        if (sql.includes('FROM tenant_enterprise_entitlement_migrations')) return receipt
        throw new Error(`unexpected query: ${sql}`)
      },
      async queryRows(sql: string) {
        statements.push(sql)
        if (sql.includes('FROM tenant_subscriptions')) return [{ id: 1, status: 'active', started_at: '2026-01-01 00:00:00', ended_at: until, current_order_id: null, plan_code: 'legacy' }]
        return []
      },
      async execute(sql: string, params: unknown[]) {
        statements.push(sql)
        if (sql.includes('INSERT INTO tenant_enterprise_entitlement_current')) revision = Number(params[1])
        if (sql.includes('INSERT INTO tenant_enterprise_entitlement_migrations')) {
          if (failReceipt) throw new Error('receipt_write_failed')
          receipt = { request_hash: params[2], result_json: params[7] }
        }
        return { affectedRows: 1, insertId: 1 }
      }
    }
    try {
      return await work(tx as Parameters<typeof work>[0])
    } catch (error) {
      revision = oldRevision
      receipt = oldReceipt
      throw error
    }
  }
  return { repo: createEnterpriseEntitlementRepository(transaction), statements, getRevision: () => revision, failReceipt: () => {
    failReceipt = true
  }, drift: () => {
    until = '2028-01-01 00:00:00'
  } }
}
const request = { tenantCode: 't1', migrationId: 'm1' }
const now = '2026-09-13T00:00:00Z'

test('conversion defaults to read-only preview without row locks or mutation', async () => {
  const f = fixture()
  const preview = await f.repo.preview(request, now)
  assert.equal(preview.result.decision, 'ready')
  assert.deepEqual(preview.result.sourceReport.sources, [{
    sourceId: 'tenant-subscription:1', kind: 'tenant-subscription', state: 'current', status: 'active', planCode: 'legacy', effectiveFrom: '2026-01-01T00:00:00Z', effectiveUntil: '2027-01-01T00:00:00Z', linkedSourceIds: []
  }])
  assert.equal(f.getRevision(), 0)
  assert.ok(f.statements.every(sql => sql.startsWith('SELECT') && !sql.includes('FOR UPDATE')))
})
test('read-only preview keeps legacy plan, order, license and binding facts while classifying conflicts', () => {
  const report = buildEnterpriseEntitlementPreviewReport({
    primary: [
      { id: 1, status: 'active', started_at: '2026-01-01 00:00:00', ended_at: '2027-01-01 00:00:00', current_order_id: 7, plan_code: 'legacy-standard' },
      { id: 2, status: 'ended', started_at: '2024-01-01 00:00:00', ended_at: '2025-01-01 00:00:00', current_order_id: null, plan_code: 'legacy-starter' }
    ],
    children: [{ id: 3, tenant_subscription_id: 1, status: 'active', started_at: '2026-01-01 00:00:00', ended_at: '2028-01-01 00:00:00', current_order_id: 7, plan_code: 'legacy-pro' }],
    orders: [{ id: 7, status: 'pending', effective_from: '2026-01-01 00:00:00', effective_until: '2026-06-01 00:00:00', paid_at: null, plan_code: 'legacy-standard' }],
    licenses: [{ id: 9, subscription_id: 3, status: 'active', issued_at: '2026-01-01 00:00:00', expires_at: '2028-01-01 00:00:00', grace_until: null, payload_hash: 'sha256_fixture' }],
    bindings: [{ id: 10, license_id: 99, deployment_id: 2, status: 'active', effective_from: '2026-01-01 00:00:00', effective_until: '2028-01-01 00:00:00' }]
  })

  assert.deepEqual(report.sources.find(item => item.sourceId === 'tenant-subscription:1'), {
    sourceId: 'tenant-subscription:1', kind: 'tenant-subscription', state: 'current', status: 'active', planCode: 'legacy-standard', effectiveFrom: '2026-01-01T00:00:00Z', effectiveUntil: '2027-01-01T00:00:00Z', linkedSourceIds: []
  })
  assert.deepEqual(report.historicalIds, ['license-deployment:10', 'tenant-subscription:2'])
  assert.deepEqual(report.conflicts.map(item => item.code), [
    'current_license_missing_deployment_binding',
    'current_order_not_paid',
    'license_period_mismatch',
    'order_period_mismatch',
    'orphan_license_binding',
    'subscription_period_mismatch',
    'subscription_plan_mismatch'
  ])
  assert.deepEqual(report.conflicts.find(item => item.code === 'subscription_period_mismatch')?.sourceIds, ['subscription:3', 'tenant-subscription:1'])
})
test('preview reports malformed legacy status as a review conflict without guessing an entitlement', () => {
  const report = buildEnterpriseEntitlementPreviewReport({
    primary: [{ id: 1, status: 'grandfathered', started_at: '2026-01-01 00:00:00', ended_at: '2027-01-01 00:00:00', current_order_id: null, plan_code: 'legacy' }],
    children: [], orders: [], licenses: [], bindings: []
  })
  assert.deepEqual(report.conflicts, [{ code: 'unmapped_legacy_entitlement_status', sourceIds: ['tenant-subscription:1'] }])
})
test('apply locks tenant first, inserts qualification/pointer/receipt only, and replays original result', async () => {
  const f = fixture()
  const preview = await f.repo.convert(request, now)
  f.statements.length = 0
  const apply = { ...request, mode: 'apply' as const, expectedRevision: 0, sourceHash: preview.result.sourceHash }
  const first = await f.repo.convert(apply, now)
  assert.match(f.statements[0]!, /FROM tenants .*FOR UPDATE$/)
  assert.equal(f.getRevision(), 1)
  assert.equal(f.statements.filter(sql => sql.startsWith('INSERT')).length, 3)
  assert.ok(f.statements.filter(sql => sql.startsWith('INSERT')).every(sql => sql.includes('tenant_enterprise_entitlement')))
  f.statements.length = 0
  const replay = await f.repo.convert(apply, '2028-01-01T00:00:00Z')
  assert.equal(replay.replayed, true)
  assert.deepEqual(replay.result, first.result)
  assert.equal(f.statements.filter(sql => sql.startsWith('INSERT')).length, 0)
  await assert.rejects(f.repo.convert({ ...apply, sourceHash: 'changed' }, now), /migration_id_payload_conflict/)
})
test('source drift and stale revision reject without writes', async () => {
  const f = fixture()
  const preview = await f.repo.convert(request, now)
  const apply = { ...request, mode: 'apply' as const, expectedRevision: 0, sourceHash: preview.result.sourceHash }
  await assert.rejects(f.repo.convert({ ...apply, expectedRevision: 1 }, now), /entitlement_migration_conflict/)
  f.drift()
  await assert.rejects(f.repo.convert(apply, now), /entitlement_migration_conflict/)
  assert.equal(f.getRevision(), 0)
  assert.equal(f.statements.filter(sql => sql.startsWith('INSERT')).length, 0)
})
test('receipt failure escapes transaction and pointer is rolled back by transaction adapter', async () => {
  const f = fixture()
  const preview = await f.repo.convert(request, now)
  f.failReceipt()
  await assert.rejects(f.repo.convert({ ...request, mode: 'apply', expectedRevision: 0, sourceHash: preview.result.sourceHash }, now), /receipt_write_failed/)
  assert.equal(f.getRevision(), 0)
})
test('apply requires explicit hash and revision; unknown mode fails closed', async () => {
  const f = fixture()
  await assert.rejects(f.repo.convert({ ...request, mode: 'apply' }, now), /migration_preconditions_required/)
  await assert.rejects(f.repo.convert({ ...request, mode: 'invalid' as 'apply' }, now), /invalid_migration_mode/)
  assert.equal(f.statements.length, 0)
})
