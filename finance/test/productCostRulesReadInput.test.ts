import test from 'node:test'
import assert from 'node:assert/strict'
import { parseProductCostRulesReadInput, parseProductCostRulesReadResult } from '../server/utils/productCostRulesReadInput.ts'

test('rule read has no product filter and distinguishes unconfigured from cleared revision', () => {
  const command = { actorUid: 'U1', projectCode: 'PRJ', periodMonth: '2026-09', action: 'read' }
  assert.ok(parseProductCostRulesReadInput(command))
  assert.equal(parseProductCostRulesReadInput({ ...command, productCode: 'P1' }), null)
  assert.equal(parseProductCostRulesReadInput({ ...command, actorUid: 'client:aims.runtime' }), null)
  const empty = { projectCode: 'PRJ', periodMonth: '2026-09', revision: 0, evidenceRef: '', shares: [] }
  assert.equal(parseProductCostRulesReadResult(empty, 'PRJ', '2026-09')?.revision, 0)
  assert.equal(parseProductCostRulesReadResult({ ...empty, revision: 2, evidenceRef: 'cleared' }, 'PRJ', '2026-09')?.revision, 2)
  assert.equal(parseProductCostRulesReadResult({ ...empty, revision: 2 }, 'PRJ', '2026-09'), null)
  assert.equal(parseProductCostRulesReadResult({ ...empty, shares: [{ productCode: 'P1', basisPoints: 1 }] }, 'PRJ', '2026-09'), null)
  const rules = { ...empty, revision: 2, evidenceRef: 'review', shares: [{ productCode: 'P1', basisPoints: 6000 }, { productCode: 'P2', basisPoints: 4000 }], internal: 'hidden' }
  const parsed = parseProductCostRulesReadResult(rules, 'PRJ', '2026-09')
  assert.equal(parsed?.shares.length, 2)
  assert.equal(JSON.stringify(parsed).includes('hidden'), false)
  assert.equal(parseProductCostRulesReadResult({ ...rules, shares: [...rules.shares, { productCode: 'P3', basisPoints: 1 }] }, 'PRJ', '2026-09'), null)
  assert.equal(parseProductCostRulesReadResult({ ...rules, shares: [rules.shares[0], rules.shares[0]] }, 'PRJ', '2026-09'), null)
})
