import assert from 'node:assert/strict'
import test from 'node:test'
import {
  productLightweightPlanConfirmInput,
  productLightweightPlanEditInput,
  productLightweightPlanItemCreateInput,
  productLightweightPlanItemDeleteInput,
  productLightweightPlanItemEditInput,
  productLightweightPlanItemPageInput
} from '../server/utils/productLightweightPlanInput.ts'

const request = '00000000-0000-4000-8000-000000000001'
const revisions = { expectedRevision: 1, expectedVersionRevision: 2, expectedPlanRevision: 3 }

test('lightweight plan input preserves unknown person days and requires all plan revisions', () => {
  const input = productLightweightPlanEditInput({ ...revisions, goal: '', startsOn: '', plannedReleaseDate: '2026-09-30', availablePersonDays: '12.50', reservePersonDays: null }, 9)
  assert.equal(input?.available_person_days, '12.50')
  assert.equal(input?.reserve_person_days, null)
  assert.equal(productLightweightPlanEditInput({ ...revisions, goal: '', startsOn: '2026-02-29', plannedReleaseDate: '', availablePersonDays: '0', reservePersonDays: '0' }, 9), null)
  assert.equal(productLightweightPlanEditInput({ expectedRevision: 1, goal: '', startsOn: '', plannedReleaseDate: '', availablePersonDays: null, reservePersonDays: null }, 9), null)
})

test('lightweight scopes bind route identity, source revision, and adoption decision', () => {
  const create = { ...revisions, requestBizId: request, expectedRequestRevision: 4, scopeSummary: '登录支持', estimatePersonDays: null, acceptanceCriteria: '', sortOrder: 0, adoptRequest: true }
  assert.equal(productLightweightPlanItemCreateInput(create, 9)?.request_biz_id, request)
  assert.equal(productLightweightPlanItemCreateInput({ ...create, adoptRequest: 'true' }, 9), null)
  const edit = { ...revisions, expectedScopeRevision: 5, scopeSummary: '登录与退出', estimatePersonDays: '1.25', acceptanceCriteria: '验收记录', sortOrder: 1 }
  assert.equal(productLightweightPlanItemEditInput(edit, 9, 7)?.scope_id, 7)
  assert.equal(productLightweightPlanItemEditInput({ ...edit, estimatePersonDays: '1.234' }, 9, 7), null)
  assert.equal(productLightweightPlanItemDeleteInput({ ...revisions, expectedScopeRevision: 5, reason: '移至后续版本' }, 9, 7)?.version_id, 9)
  assert.equal(productLightweightPlanConfirmInput({ ...revisions, expectedScopeRevision: 5 }, 9)?.expected_scope_revision, 5)
})

test('lightweight scope list validates bounded server pagination', () => {
  assert.deepEqual(productLightweightPlanItemPageInput({}), { page: 1, page_size: 20, keyword: '' })
  assert.equal(productLightweightPlanItemPageInput({ page: '0' }), null)
  assert.equal(productLightweightPlanItemPageInput({ componentId: '1' }), null)
})
