import { test } from 'node:test'
import assert from 'node:assert/strict'
import { productRequestSourceInput, productRequestSourceDeleteInput } from '../server/utils/productRequestSourceInput.ts'

const id = 'b5eb7544-0695-4dc1-bc60-107d3e204742'
const input = { expectedRevision: 2, expectedRequestRevision: 1, note: '客户访谈原话', kind: 'fact', direction: 'opposing' }
test('manual sources keep unknown dates and reject forged external verification', () => {
  assert.equal(productRequestSourceInput(input, id)?.evidence_date, null)
  assert.equal(productRequestSourceInput({ ...input, evidenceDate: '2024-02-29' }, id)?.evidence_date, '2024-02-29')
  for (const patch of [{ sourceApp: 'altoc' }, { sourceBizId: 'C001' }, { verificationStatus: 'verified' }, { createdBy: 'admin' }, { authorization: {} }, { evidenceDate: '2026-02-29' }, { evidenceDate: '2026-2-01' }, { evidenceDate: '' }, { note: '\uD800' }, { note: ' ' }, { note: '字'.repeat(10001) }, { expectedRevision: '2' }, { expectedRequestRevision: 0 }, { kind: 'verified' }, { direction: 'positive' }]) assert.equal(productRequestSourceInput({ ...input, ...patch }, id), null)
  assert.equal(productRequestSourceInput(input, '1'), null)
})

const deletion = { expectedRevision: 3, expectedRequestRevision: 2, expectedSourceRevision: 1, reason: '重复录入证据' }
test('source deletion requires scoped identifiers, all revisions and a reason', () => {
  assert.equal(productRequestSourceDeleteInput(deletion, id, '12')?.source_id, 12)
  for (const sourceId of ['0', '-1', '01', '1.0', '1e2', '9007199254740992', '']) assert.equal(productRequestSourceDeleteInput(deletion, id, sourceId), null)
  for (const patch of [{ expectedRevision: 0 }, { expectedRequestRevision: '2' }, { expectedSourceRevision: undefined }, { reason: ' ' }, { reason: '\uD800' }, { reason: '字'.repeat(2001) }, { actor: 'admin' }, { sourceId: 13 }, { authorization: {} }]) assert.equal(productRequestSourceDeleteInput({ ...deletion, ...patch }, id, '12'), null)
  assert.equal(productRequestSourceDeleteInput(deletion, 'other', '12'), null)
})
