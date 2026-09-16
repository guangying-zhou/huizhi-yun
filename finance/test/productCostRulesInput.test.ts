import test from 'node:test'
import assert from 'node:assert/strict'
import { parseProductCostRulesInput } from '../server/utils/productCostRulesInput.ts'

test('complete rules input preserves shares and rejects ambiguous or excess allocations', () => {
  const valid = { actorUid: 'U1', projectCode: 'PRJ1', periodMonth: '2026-09', expectedRevision: 2, evidenceRef: '审批记录', shares: [{ productCode: 'P1', basisPoints: 6000 }, { productCode: 'P2', basisPoints: 4000 }] }
  assert.deepEqual(parseProductCostRulesInput(valid), valid)
  assert.deepEqual(parseProductCostRulesInput({ ...valid, shares: [] })?.shares, [])
  for (const override of [
    { expectedRevision: '2' }, { expectedRevision: 0.5 }, { expectedRevision: Number.MAX_SAFE_INTEGER },
    { actorUid: 'client:aims.runtime' }, { periodMonth: '0000-01' }, { evidenceRef: '中'.repeat(167) },
    { scope: 'all' }, { shares: null }, { shares: [...valid.shares, valid.shares[0]] },
    { shares: [{ productCode: 'P1', basisPoints: 10001 }] },
    { shares: [{ productCode: 'P1', basisPoints: 10000, amount: '1.00' }] }
  ]) assert.equal(parseProductCostRulesInput({ ...valid, ...override }), null)
})
