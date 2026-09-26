import assert from 'node:assert/strict'
import { createEnterpriseOrderFulfillmentRepository, confirmEnterpriseOrderPayment } from '../../server/utils/enterpriseOrderFulfillment.ts'
import { createEnterpriseEntitlementStateRepository } from '../../server/utils/enterpriseEntitlementState.ts'

export async function testEnterpriseOrderFlow({ pool, withTransaction }) {
  const now = '2026-09-13T00:00:00Z'
  await pool.query('INSERT INTO tenants VALUES (\'order-a\',\'active\'),(\'order-b\',\'active\'),(\'order-c\',\'active\')')
  const order = async (id, tenant, from, until, status = 'paid') => {
    await pool.execute('INSERT INTO platform_orders (id,order_no,tenant_code,plan_code,status,effective_from,effective_until,total_amount,currency,payment_method) VALUES (?,?,?,\'enterprise-full\',?,?,?,?,\'CNY\',\'bank_transfer\')', [id, `ORDER-${id}`, tenant, status, from, until, '120.00'])
    if (status === 'paid') await pool.execute('INSERT INTO platform_payments (payment_no,order_id,tenant_code,amount,currency,status) VALUES (?,?,?,\'120.00\',\'CNY\',\'succeeded\')', [`PAID-${id}`, id, tenant])
  }
  await order(101, 'order-a', '2026-08-01', '2027-02-01')
  const repo = createEnterpriseOrderFulfillmentRepository(withTransaction)
  const states = createEnterpriseEntitlementStateRepository(withTransaction)
  const fulfill = id => repo.fulfill({ tenantCode: 'order-a', orderId: id, actorUid: 'ops-order' }, now)
  const initial = await Promise.all([fulfill(101), fulfill(101)])
  assert.equal(initial.filter(result => result.replayed).length, 1)
  assert.equal(initial[0].entitlement.end.effectiveUntil, '2027-02-01T00:00:00.000Z')
  await states.change({ tenantCode: 'order-a', operationId: 'order-suspend', expectedRevision: 1, action: 'suspend', actorUid: 'ops-order', reason: 'fixture' }, now)
  await order(102, 'order-a', '2027-02-01', '2027-04-15')
  const renewed = await fulfill(102)
  assert.equal(renewed.entitlement.status, 'suspended')
  assert.equal(renewed.entitlement.effectiveFrom, '2026-08-01T00:00:00.000Z')
  assert.equal(renewed.entitlement.end.effectiveUntil, '2027-04-15T00:00:00.000Z')
  const restored = await states.change({ tenantCode: 'order-a', operationId: 'order-restore', expectedRevision: 3, action: 'restore', actorUid: 'ops-order', reason: 'fixture' }, now)
  assert.equal(restored.entitlement.end.effectiveUntil, renewed.entitlement.end.effectiveUntil)
  await pool.query('UPDATE platform_orders SET effective_until=\'2027-05-01\' WHERE id=102')
  await assert.rejects(fulfill(102), /enterprise_order_source_conflict/)
  await order(103, 'order-a', null, null)
  await assert.rejects(fulfill(103), /enterprise_order_period_required/)
  await order(104, 'order-a', '2027-04-15', '2027-06-01')
  await pool.query('UPDATE platform_payments SET amount=\'10.00\' WHERE order_id=104')
  await assert.rejects(fulfill(104), /enterprise_order_payment_evidence_required/)
  await order(105, 'order-b', '2026-09-01', '2027-01-15', 'pending')
  const confirm = { tenantCode: 'order-b', orderId: 105, actorUid: 'ops-order', accountId: null, bankTransactionNo: 'fixture-ref', paidAt: now }
  const confirmed = await confirmEnterpriseOrderPayment(confirm)
  assert.equal(confirmed.entitlement.end.effectiveUntil, '2027-01-15T00:00:00.000Z')
  assert.equal((await confirmEnterpriseOrderPayment(confirm)).replayed, true)
  const row = (await pool.query('SELECT effective_from,effective_until,total_amount FROM platform_orders WHERE id=105'))[0][0]
  assert.equal(row.effective_from, '2026-09-01 00:00:00')
  assert.equal(row.effective_until, '2027-01-15 00:00:00')
  assert.equal(row.total_amount, '120.00')
  await order(106, 'order-c', '2026-09-01', '2027-01-15', 'pending')
  await pool.query('CREATE TRIGGER fail_order_fulfillment BEFORE INSERT ON tenant_enterprise_order_fulfillments FOR EACH ROW SIGNAL SQLSTATE \'45000\' SET MESSAGE_TEXT=\'fixture_order_receipt_failure\'')
  await assert.rejects(confirmEnterpriseOrderPayment({ ...confirm, tenantCode: 'order-c', orderId: 106 }), /fixture_order_receipt_failure/)
  assert.equal((await pool.query('SELECT status FROM platform_orders WHERE id=106'))[0][0].status, 'pending')
  assert.equal(Number((await pool.query('SELECT COUNT(*) AS n FROM platform_payments WHERE order_id=106'))[0][0].n), 0)
  assert.equal(Number((await pool.query('SELECT COUNT(*) AS n FROM tenant_enterprise_entitlements WHERE tenant_code=\'order-c\''))[0][0].n), 0)
  await pool.query('DROP TRIGGER fail_order_fulfillment')
  console.log('Enterprise confirmed orders: exact periods, concurrent replay, suspended renewal, source/payment checks and atomic payment/qualification rollback passed.')
}

/** Independent order integration target, still confined to the caller's fresh MySQL harness. */
export async function testEnterpriseOrdersWithNuxtHost({ rootDir, context, pool, withTransaction }) {
  const { registerEnterpriseNuxtTestHost } = await import('./enterprise-nuxt-test-host.mjs')
  const hooks = registerEnterpriseNuxtTestHost(rootDir)
  const previous = globalThis.useRuntimeConfig
  let db
  try {
    globalThis.useRuntimeConfig = () => ({ db: { ...context.connection('console'), name: context.connection('console').database } })
    db = await import('../../server/utils/db.ts')
    await testEnterpriseOrderFlow({ pool, withTransaction })
  } finally {
    if (db) await db.useDbPool().end()
    globalThis.useRuntimeConfig = previous
    hooks.deregister()
  }
}
