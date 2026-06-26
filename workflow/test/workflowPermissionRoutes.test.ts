import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { resolveWorkflowRoutePermission } from '../server/utils/workflowPermissionRoutes.ts'

describe('resolveWorkflowRoutePermission', () => {
  test('审批任务动作要求精确权限', () => {
    assert.deepEqual(
      resolveWorkflowRoutePermission('/tasks/42/approve', 'POST'),
      { resource: 'workflow_tasks', action: 'approve' }
    )
    assert.deepEqual(
      resolveWorkflowRoutePermission('/tasks/42/reject', 'POST'),
      { resource: 'workflow_tasks', action: 'reject' }
    )
    assert.deepEqual(
      resolveWorkflowRoutePermission('/tasks/42/delegate', 'POST'),
      { resource: 'workflow_tasks', action: 'delegate' }
    )
  })

  test('实例状态变更要求精确权限', () => {
    assert.deepEqual(
      resolveWorkflowRoutePermission('/instances/88/cancel', 'POST'),
      { resource: 'workflow_instances', action: 'cancel' }
    )
    assert.deepEqual(
      resolveWorkflowRoutePermission('/instances/88/resubmit', 'POST'),
      { resource: 'workflow_instances', action: 'resubmit' }
    )
  })

  test('非敏感路径不附加精确权限映射', () => {
    assert.equal(resolveWorkflowRoutePermission('/tasks/42/approve', 'GET'), null)
    assert.equal(resolveWorkflowRoutePermission('/tasks/42', 'POST'), null)
    assert.equal(resolveWorkflowRoutePermission('/instances/88', 'PATCH'), null)
  })
})
