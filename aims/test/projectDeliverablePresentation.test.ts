import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  deliverableStatusBadge,
  deliverableTypeBadge,
  qualityStatusBadge,
  releaseStatusBadge
} from '../app/utils/projectDeliverablePresentation.ts'

test('project deliverable and release badges use Chinese labels and semantic colors', () => {
  assert.deepEqual(deliverableStatusBadge('pending'), { label: '待提交', color: 'neutral' })
  assert.deepEqual(deliverableStatusBadge('approved'), { label: '已通过', color: 'success' })
  assert.deepEqual(qualityStatusBadge('awaiting_review'), { label: '质量待审', color: 'info' })
  assert.deepEqual(qualityStatusBadge('returned'), { label: '质量退回', color: 'error' })
  assert.deepEqual(deliverableTypeBadge('document'), { label: '文档', color: 'info' })
  assert.deepEqual(deliverableTypeBadge('code'), { label: '代码', color: 'primary' })
  assert.deepEqual(releaseStatusBadge('developing'), { label: '开发中', color: 'info' })
  assert.deepEqual(releaseStatusBadge('released'), { label: '已发布', color: 'success' })
})

test('unknown codes never surface as raw status or type labels', () => {
  assert.deepEqual(deliverableStatusBadge('future_status'), { label: '未知状态', color: 'neutral' })
  assert.deepEqual(qualityStatusBadge('future_status', 'submitted'), { label: '已提交', color: 'info' })
  assert.deepEqual(deliverableTypeBadge('future_type'), { label: '其他类型', color: 'neutral' })
  assert.deepEqual(releaseStatusBadge('future_status'), { label: '未知状态', color: 'neutral' })
})
