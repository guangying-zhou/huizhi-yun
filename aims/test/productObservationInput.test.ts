import assert from 'node:assert/strict'
import test from 'node:test'
import { productObservationDetailInput, productObservationCreateInput, productObservationPageInput } from '../server/utils/productObservationInput.ts'

const id = '00000000-0000-4000-8000-000000000001'
const valid = { expectedRevision: 1, expectedCycleRevision: 2, reason: '统计完成', valueMode: 'known', observedValue: '99999999999999.123456', observedAt: '2026-01-01T08:00:00.123+08:00', evidenceSummary: '试点样本', evidenceSource: '人工统计表', conclusion: '继续观察', correctionOfId: null }
test('observations preserve decimals and explicit unknowns, reject invalid data and overrides', () => {
  assert.equal(productObservationCreateInput(valid, id)?.observed_value, valid.observedValue)
  assert.equal(productObservationCreateInput({ ...valid, valueMode: 'unknown', observedValue: null }, id)?.observed_value, null)
  for (const patch of [{ observedValue: 12 }, { observedValue: '1e3' }, { valueMode: 'unknown' }, { correctionOfId: undefined }, { correctionOfId: 0 }, { recordedBy: 'other' }, { metricSnapshot: {} }, { observedAt: '2026-02-30T00:00:00Z' }, { observedAt: '2026-01-01T00:00:00.1234Z' }, { evidenceSource: '' }]) assert.equal(productObservationCreateInput({ ...valid, ...patch }, id), null)
})
test('observation pagination binds cycle and rejects unsupported filters', () => {
  assert.deepEqual(productObservationPageInput({ page: '2', pageSize: '10' }, id), { cycle_biz_id: id, page: 2, page_size: 10 })
  for (const query of [{ page: '0' }, { pageSize: '101' }, { page: ['1'] }, { cycleId: id }, { keyword: 'hidden' }]) assert.equal(productObservationPageInput(query, id), null)
  assert.equal(productObservationPageInput({}, 'invalid'), null)
})

test('observation detail binds both path IDs and rejects queries', () => {
  assert.deepEqual(productObservationDetailInput({}, id, '2'), { cycle_biz_id: id, observation_id: 2 })
  for (const value of ['0', '-1', '2.0', '9007199254740992']) assert.equal(productObservationDetailInput({}, id, value), null)
  assert.equal(productObservationDetailInput({ page: '1' }, id, '2'), null)
})
