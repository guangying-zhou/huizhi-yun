import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { requirementReviewMilestoneIssues } from '../app/utils/requirementReviewMilestoneValidation.ts'

const currentMilestone = { id: 7, name: '实施' }

function validate(overrides: Partial<Parameters<typeof requirementReviewMilestoneIssues>[0]> = {}) {
  return requirementReviewMilestoneIssues({
    context: 'selection',
    currentMilestone,
    requirementIds: [1],
    requirements: [{ id: 1, reqCode: 'REQ-1', milestoneId: 7, milestoneName: '实施' }],
    ...overrides
  })
}

describe('requirement review milestone validation', () => {
  test('fails closed when there is no active milestone, with context-specific guidance', () => {
    assert.deepEqual(validate({ currentMilestone: null }), ['当前没有活动里程碑，暂不可创建需求评审批次'])
    assert.deepEqual(validate({ context: 'batch', currentMilestone: null }), ['当前没有活动里程碑，暂不可提交需求评审'])
  })

  test('requires every selected requirement to be resolved before creating a batch', () => {
    assert.deepEqual(validate({ requirementIds: [1, 2] }), ['部分已选需求未加载完成，请刷新后重试'])
  })

  test('rejects an empty batch before accepting loaded rows', () => {
    assert.deepEqual(validate({ context: 'batch', requirementIds: [], requirements: [] }), ['该评审批次没有关联需求项'])
  })

  test('reports up to three requirements that have no milestone and preserves the count suffix', () => {
    const requirements = [1, 2, 3, 4].map(id => ({
      id,
      reqCode: `REQ-${id}`,
      milestoneId: null,
      milestoneName: null
    }))

    assert.deepEqual(validate({ requirementIds: [1, 2, 3, 4], requirements }), [
      '所选需求中有未绑定里程碑的项（REQ-1、REQ-2、REQ-3 等 4 条），无法创建评审批次'
    ])
  })

  test('rejects a selection that spans multiple milestones', () => {
    assert.deepEqual(validate({
      requirementIds: [1, 2],
      requirements: [
        { id: 1, reqCode: 'REQ-1', milestoneId: 7, milestoneName: '实施' },
        { id: 2, reqCode: 'REQ-2', milestoneId: 8, milestoneName: '验收' }
      ]
    }), ['所选需求包含多个里程碑（实施、验收），仅允许创建当前活动里程碑的评审批次'])
  })

  test('rejects a single non-active milestone and permits the active milestone', () => {
    assert.deepEqual(validate({
      requirements: [{ id: 1, reqCode: 'REQ-1', milestoneId: 8, milestoneName: '验收' }]
    }), ['仅当前活动里程碑「实施」的需求可创建评审批次，当前选择属于「验收」'])
    assert.deepEqual(validate(), [])
  })

  test('uses batch wording after the page has resolved batch requirements', () => {
    assert.deepEqual(validate({
      context: 'batch',
      requirements: [{ id: 1, reqCode: 'REQ-1', milestoneId: null, milestoneName: null }]
    }), ['批次中有需求未绑定里程碑（REQ-1），无法提交审批'])
  })
})
