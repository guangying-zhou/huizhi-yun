import { test } from 'node:test'
import assert from 'node:assert/strict'
import { productLineOnboardInput } from '../server/utils/productLineInput.ts'
import { productListInput } from '../server/utils/productListInput.ts'

const input = { productLine: 'TY', managerUid: 'manager', productCodes: ['HZ-TY-S-001', 'HZ-TY-S-002'], expectedWatermark: '550e8400-e29b-41d4-a716-446655440000:1' }
test('line onboarding only accepts reviewed line, watermark, manager and picked products; never browser source facts', () => {
  const accepted = productLineOnboardInput(input)
  assert.equal(accepted?.line_code, 'TY')
  assert.deepEqual(accepted?.product_codes, ['HZ-TY-S-001', 'HZ-TY-S-002'])
  for (const invalid of [{ ...input, items: [] }, { ...input, source: {} }, { ...input, authorization: {} }, { ...input, reason: '统一管理' }, { ...input, productLine: '' }, { ...input, expectedWatermark: '' }, { ...input, expectedWatermark: '-'.repeat(36) + ':1' }, { ...input, managerUid: '' }]) assert.equal(productLineOnboardInput(invalid), null)
})
test('picked products must be a non-empty unique list of plain product codes', () => {
  for (const codes of [[], ['A', 'A'], ['A', ''], ['A', 'B/C'], ['A', 'B,C'], [' A'], ['x'.repeat(65)], ['A', 1], 'A', Array.from({ length: 1001 }, (_, n) => `P-${n}`)]) {
    assert.equal(productLineOnboardInput({ ...input, productCodes: codes }), null, JSON.stringify(codes).slice(0, 40))
  }
})
test('tree parent and child pagination cannot accept authorization hints', () => {
  assert.equal(productListInput({ tree: 'true' })?.tree, true)
  assert.equal(productListInput({ tree: 'true', childLine: '' })?.child_line, '')
  assert.equal(productListInput({ childLine: 'TY' }), null)
  assert.equal(productListInput({ tree: 'true', canOnboard: 'true' }), null)
})
