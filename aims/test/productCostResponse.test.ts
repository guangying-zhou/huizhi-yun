import test from 'node:test'
import assert from 'node:assert/strict'
import { parseProductCostResponse } from '../server/utils/productCostResponse.ts'

test('product cost response validates scope, currency and readiness and strips internal data', () => {
  const valid = { productCode: 'P1', projectCode: 'PRJ1', periodMonth: '2026-09', ready: true, reasons: [], ruleRevision: 1, sourceRevision: 'a'.repeat(64), basisPoints: 5000, costs: [{ currencyCode: 'CNY', amount: '50.00', salary: 'private' }], costBasis: 'finance_non_canceled_expense_and_active_allocations_v1', revenueReady: false, revenueReason: 'revenue_attribution_not_configured', employee: 'private' }
  const parse = (value: unknown) => parseProductCostResponse(value, 'P1', 'PRJ1', '2026-09')
  assert.ok(parse(valid))
  assert.equal(JSON.stringify(parse(valid)).includes('private'), false)
  for (const override of [
    { projectCode: 'OTHER' }, { periodMonth: '2026-10' }, { ruleRevision: 0 }, { basisPoints: 10001 },
    { costs: [{ currencyCode: 'CNY', amount: 50 }] }, { costs: [...valid.costs, ...valid.costs] },
    { ready: false }, { revenueReady: true }, { reasons: ['missing_cost_currency'] }
  ]) assert.equal(parse({ ...valid, ...override }), null)
  assert.ok(parse({ ...valid, ready: false, costs: [], reasons: ['missing_cost_currency'] }))
})
