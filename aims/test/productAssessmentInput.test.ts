import { test } from 'node:test'
import assert from 'node:assert/strict'
import { productAssessmentCreateInput, productAssessmentPageInput } from '../server/utils/productAssessmentInput.ts'

const cycle = '00000000-0000-4000-8000-000000000001', item = '00000000-0000-4000-8000-000000000002'
const dimensions = ['strategic', 'user_value', 'business', 'risk', 'confidence', 'effort_person_days']
function draft() {
  return { expectedRevision: 1, expectedCycleRevision: 2, expectedItemRevision: 3, expectedScopeRevision: 1, expectedEvidenceRevision: 1, assessment: { model_version: 'weighted-value-effort-v1', effort_unit: 'person_day', strategic: 5, user_value: 4, business: 4, risk: 2, confidence: '0.80', effort_person_days: '8.00' }, rationale: Object.fromEntries(dimensions.map(key => [key, '试点依据'])), evidenceReferences: Object.fromEntries(dimensions.map(key => [key, ['trial']])), evidence: [{ key: 'trial', summary: '隔离试点观察', observed_on: '2026-09-07', kind: 'fact', polarity: 'supporting' }], estimateConfirmed: true }
}
test('assessment input binds identities and preserves exact decimal data', () => {
  const result = productAssessmentCreateInput(draft(), cycle, item)
  assert.equal(result?.cycle_biz_id, cycle)
  assert.equal(result?.item_biz_id, item)
  assert.equal(result?.assessment.effort_person_days, '8.00')
  assert.equal(result?.expected_item_revision, 3)
  for (const extra of [{ actor: 'admin' }, { estimatedBy: 'other' }, { priority_score: 100 }, { itemId: cycle }]) assert.equal(productAssessmentCreateInput({ ...draft(), ...extra }, cycle, item), null)
  for (const key of ['expectedRevision', 'expectedCycleRevision', 'expectedItemRevision', 'expectedScopeRevision', 'expectedEvidenceRevision']) for (const bad of [undefined, 0, '1', 1.5, Number.MAX_SAFE_INTEGER + 1]) assert.equal(productAssessmentCreateInput({ ...draft(), [key]: bad }, cycle, item), null)
  assert.equal(productAssessmentCreateInput(draft(), 'bad', item), null)
})
test('assessment rejects invalid numbers, missing dimensions and evidence links', () => {
  for (const patch of [{ confidence: 0.8 }, { confidence: '0.7' }, { effort_person_days: '0.49' }, { effort_person_days: '1000000.01' }, { effort_person_days: 8 }, { strategic: 6 }, { risk: undefined }, { priority_score: 100 }, { effort_unit: 'hours' }]) assert.equal(productAssessmentCreateInput({ ...draft(), assessment: { ...draft().assessment, ...patch } }, cycle, item), null)
  assert.equal(productAssessmentCreateInput({ ...draft(), estimateConfirmed: false }, cycle, item), null)
  const missing = draft()
  delete missing.evidenceReferences.risk
  assert.equal(productAssessmentCreateInput(missing, cycle, item), null)
  for (const refs of [['missing'], ['trial', 'trial'], []]) assert.equal(productAssessmentCreateInput({ ...draft(), evidenceReferences: { ...draft().evidenceReferences, risk: refs } }, cycle, item), null)
  for (const patch of [{ observed_on: '2026-02-30' }, { key: '../trial' }, { summary: '\uD800' }, { kind: 'verified_external' }, { kind: ['fact'] }, { actor: 'admin' }]) assert.equal(productAssessmentCreateInput({ ...draft(), evidence: [{ ...draft().evidence[0], ...patch }] }, cycle, item), null)
})
test('unknown assessment requires explicit null and retains unknown scores', () => {
  const raw = { ...draft(), assessment: { model_version: 'weighted-value-effort-v1', effort_unit: 'person_day', ...Object.fromEntries(dimensions.map(key => [key, null])) }, rationale: {}, evidenceReferences: {}, evidence: [], estimateConfirmed: false }
  const result = productAssessmentCreateInput(raw, cycle, item)
  assert.ok(result)
  assert.equal(result.assessment.strategic, null)
  assert.equal(result.assessment.effort_person_days, null)
  assert.equal(productAssessmentCreateInput({ ...raw, estimateConfirmed: true }, cycle, item), null)
})

test('assessment history pagination rejects identity overrides and malformed pagination', () => {
  assert.deepEqual(productAssessmentPageInput({}, cycle, item), { cycle_biz_id: cycle, item_biz_id: item, page: 1, page_size: 20 })
  assert.equal(productAssessmentPageInput({ page: '2', pageSize: '100' }, cycle, item)?.page, 2)
  for (const query of [{ page: '0' }, { page: ['1'] }, { page: 1 }, { page: '1e2' }, { page: '1000001' }, { pageSize: '101' }, { itemId: item }, { actor: 'admin' }, { keyword: 'a' }]) assert.equal(productAssessmentPageInput(query, cycle, item), null)
  assert.equal(productAssessmentPageInput({}, 'bad', item), null)
  assert.equal(productAssessmentPageInput({}, cycle, 'bad'), null)
})

test('assessment accepts custom version identifiers but never caller model rules', () => {
  const custom = { ...draft(), assessment: { ...draft().assessment, model_version: 'customer-v2' } }
  assert.equal(productAssessmentCreateInput(custom, cycle, item)?.assessment.model_version, 'customer-v2')
  for (const model_version of ['', ' v2', 'v2/other', 'v2\n', 'x'.repeat(65)]) assert.equal(productAssessmentCreateInput({ ...custom, assessment: { ...custom.assessment, model_version } }, cycle, item), null)
  for (const extra of [{ weights: { user_value: 100 } }, { model_snapshot: {} }, { value_score: 100 }]) assert.equal(productAssessmentCreateInput({ ...custom, assessment: { ...custom.assessment, ...extra } }, cycle, item), null)
})

test('RICE binds a stored observation and rejects caller Reach or weighted fields', async () => {
  const { productRICEAssessmentCreateInput: parse } = await import('../server/utils/productAssessmentInput.ts')
  const riceDimensions = ['impact', 'confidence', 'effort_person_days']
  const raw = { ...draft(), assessment: { model_version: 'rice-v1', observation_biz_id: item, effort_unit: 'person_day', impact: '2.00', confidence: '0.80', effort_person_days: '8.00' }, rationale: Object.fromEntries(riceDimensions.map(key => [key, '试点依据'])), evidenceReferences: Object.fromEntries(riceDimensions.map(key => [key, ['trial']])) }
  assert.equal(parse(raw, cycle, item)?.assessment.observation_biz_id, item)
  assert.equal(parse(raw, cycle, item)?.assessment.impact, '2.00')
  assert.equal(productAssessmentCreateInput(raw, cycle, item), null)
  for (const patch of [{ reach: 450 }, { verified: true }, { strategic: 5 }, { observation_biz_id: null }, { observation_biz_id: 'bad' }, { impact: 2 }, { impact: '0.75' }, { impact: undefined }]) assert.equal(parse({ ...raw, assessment: { ...raw.assessment, ...patch } }, cycle, item), null)
  assert.equal(parse({ ...raw, rationale: { ...raw.rationale, reach: 'manual override' } }, cycle, item), null)
  assert.equal(parse({ ...raw, evidenceReferences: { ...raw.evidenceReferences, impact: ['missing'] } }, cycle, item), null)
  assert.equal(parse({ ...raw, estimateConfirmed: false }, cycle, item), null)
  const unknown = { ...raw, assessment: { ...raw.assessment, observation_biz_id: '', impact: null, confidence: null, effort_person_days: null }, rationale: {}, evidenceReferences: {}, evidence: [], estimateConfirmed: false }
  assert.equal(parse(unknown, cycle, item)?.assessment.impact, null)
  assert.equal(parse(unknown, cycle, item)?.assessment.observation_biz_id, '')
})
