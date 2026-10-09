import test from 'node:test'
import assert from 'node:assert/strict'
import { settlementTarget, settlementContext } from '../app/utils/settlementWorkspace.ts'

test('workspace locator accepts exact existing object paths, never arbitrary redirects or authority', () => {
  assert.deepEqual(settlementTarget('/finance/receipts/R-1/allocate'), { kind: 'receipts', code: 'R-1', action: 'allocate' })
  assert.deepEqual(settlementTarget('/finance/invoices/requests/new'), { kind: 'invoice-requests', code: '', action: 'new' })
  assert.equal(settlementTarget('/altoc/payments/123')?.code, '123')
  for (const path of ['https://example.org/finance/receipts/R', '//example.org/finance/receipts/R', '/finance/receipts/R?actor=admin', '/finance/receipts/../secrets', '/finance/invoices/I/allocate', '/altoc/payments/foo', '/finance/receipts/R/activate', '/console/users']) assert.equal(settlementTarget(path), null, path)
})
test('prefill copies stable codes and currency but never treats migration IDs or actor flags as authority', () => {
  assert.deepEqual(settlementContext({ customer_id: 123, contract_id: 456, confirmed_by: 'other', scope: '*', customer_code: 'C1', contract_code: 'K1', billing_schedule_code: 'B1', currency_code: 'CNY', received_amount: '100' }), { customerCode: 'C1', contractCode: 'K1', billingScheduleCode: 'B1', currencyCode: 'CNY' })
  assert.deepEqual(settlementContext({ customer_id: 1 }), {})
})
