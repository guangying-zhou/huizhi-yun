import assert from 'node:assert/strict'
import test from 'node:test'
import { productHandoffInput } from '../server/utils/productHandoffInput.ts'

const item = '00000000-0000-4000-8000-000000000001'
const request = '00000000-0000-4000-8000-000000000003'
const base = { cycleBizId: '00000000-0000-4000-8000-000000000002', expectedRevision: 1, expectedItemRevision: 1, expectedCycleRevision: 1, expectedQueueRevision: 1, projectCode: 'PRJ', sliceKey: 'default', operation: 'create', title: '统一身份', scopeSummary: '登录与退出', reason: '本期交付' }
test('handoff binds route identity and rejects forged authority or mixed operations', () => {
  assert.equal(productHandoffInput(base, item)?.item_biz_id, item)
  assert.equal(productHandoffInput({ ...base, expectedRequestRevision: 1 }, item, request)?.request_biz_id, request)
  for (const bad of [
    { ...base, project_authorization: {} }, { ...base, actor_uid: 'admin' },
    { ...base, expectedRevision: '1' }, { ...base, scopeSummary: '界'.repeat(2001) },
    { ...base, requirementId: 42 }, { ...base, operation: 'link' },
    { ...base, plannedVersionFeatureId: 9 }, { ...base, requestBizId: request },
    { ...base, expectedRequestRevision: 1 }, { ...base, sliceKey: ' default' }
  ]) assert.equal(productHandoffInput(bad, item), null)
  assert.equal(productHandoffInput(base, item, ''), null)
  assert.equal(productHandoffInput({ ...base, requestBizId: item, expectedRequestRevision: 1 }, item, request), null)
  assert.equal(productHandoffInput({ ...base, title: '', operation: 'link', requirementId: 42 }, item)?.requirement_id, 42)
})

test('lightweight scopes omit the cycle gate while legacy scoped transfer retains it', () => {
  const simple = {
    expectedRevision: 1, expectedItemRevision: 2, requestBizId: request, expectedRequestRevision: 3,
    projectCode: 'PRJ', sliceKey: 'default', operation: 'create', title: '统一身份', scopeSummary: '登录与退出', reason: '确认范围转交', plannedVersionId: 4, plannedVersionFeatureId: 5
  }
  const parsed = productHandoffInput(simple, item)
  assert.equal(parsed?.planned_version_id, 4)
  assert.equal(parsed?.cycle_biz_id, '')
  for (const patch of [{ cycleBizId: base.cycleBizId }, { expectedCycleRevision: 1 }, { expectedQueueRevision: 1 }, { plannedVersionId: 0, plannedVersionFeatureId: 5 }]) assert.equal(productHandoffInput({ ...simple, ...patch }, item), null)
  const legacyScoped = productHandoffInput({ ...base, plannedVersionId: 4, plannedVersionFeatureId: 5 }, item)
  assert.equal(legacyScoped?.cycle_biz_id, base.cycleBizId)
  assert.equal(legacyScoped?.planned_version_feature_id, 5)
})
