import test from 'node:test'
import assert from 'node:assert/strict'
import { parseProductCostRulesResponse } from '../server/utils/productCostRulesResponse.ts'

test('complete rule baseline preserves revision and rejects partial or invalid rules', () => {
  const row = { projectCode: 'PRJ', periodMonth: '2026-09', revision: 1, evidenceRef: 'review', shares: [{ productCode: 'P1', basisPoints: 5000 }, { productCode: 'P2', basisPoints: 3000 }], internal: 'hidden' }
  const parsed = parseProductCostRulesResponse(row, 'PRJ', '2026-09')
  assert.equal(parsed?.shares.length, 2)
  assert.equal(JSON.stringify(parsed).includes('hidden'), false)
  for (const changes of [{ revision: '1' }, { revision: 0 }, { projectCode: 'OTHER' }, { evidenceRef: '' }, { shares: [row.shares[0], row.shares[0]] }, { shares: [{ productCode: 'P1', basisPoints: 10001 }] }]) {
    assert.equal(parseProductCostRulesResponse({ ...row, ...changes }, 'PRJ', '2026-09'), null)
  }
  assert.ok(parseProductCostRulesResponse({ ...row, revision: 0, evidenceRef: '', shares: [] }, 'PRJ', '2026-09'))
  assert.ok(parseProductCostRulesResponse({ ...row, shares: [] }, 'PRJ', '2026-09'))
})
