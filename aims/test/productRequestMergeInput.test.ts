import { test } from 'node:test'
import assert from 'node:assert/strict'
import { productRequestMergeInput } from '../server/utils/productRequestInput.ts'

const source = '00000000-0000-4000-8000-000000000001'
const target = '00000000-0000-4000-8000-000000000002'
const input = { targetBizId: target, expectedRevision: 3, expectedRequestRevision: 1, expectedTargetRevision: 1, reason: '同一问题' }
test('request merge validates both identifiers and all revisions without accepting authority fields', () => {
  assert.equal(productRequestMergeInput(input, source)?.target_biz_id, target)
  assert.equal(productRequestMergeInput(input, source)?.impact_note, '')
  for (const patch of [{ targetBizId: source }, { targetBizId: '1' }, { expectedRevision: 0 }, { expectedTargetRevision: '1' }, { expectedRequestRevision: undefined }, { reason: '' }, { reason: '\uD800' }, { impactNote: null }, { reason: '字'.repeat(2001) }, { actor: 'admin' }, { authorization: {} }, { productCode: 'other' }]) assert.equal(productRequestMergeInput({ ...input, ...patch }, source), null)
  assert.equal(productRequestMergeInput(input, 'invalid'), null)
})
