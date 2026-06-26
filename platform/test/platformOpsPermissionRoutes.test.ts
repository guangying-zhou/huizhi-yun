import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveOpsPermission } from '../server/utils/platformOpsPermissionRoutes.ts'

describe('resolveOpsPermission 敏感动作映射', () => {
  test('银行转账订单确认要求 subscriptions/confirm', () => {
    assert.deepEqual(
      resolveOpsPermission('/api/platform/ops/subscriptions/orders/ORD-1/confirm', 'POST'),
      { resourceCode: 'ops.subscriptions', requiredAction: 'confirm' }
    )
  })

  test('普通订阅写入仍要求 subscriptions/edit', () => {
    assert.deepEqual(
      resolveOpsPermission('/api/platform/ops/subscriptions', 'POST'),
      { resourceCode: 'ops.subscriptions', requiredAction: 'edit' }
    )
  })

  test('部署写入要求 deployments/deploy', () => {
    assert.deepEqual(
      resolveOpsPermission('/api/platform/ops/deployments', 'POST'),
      { resourceCode: 'ops.deployments', requiredAction: 'deploy' }
    )
    assert.deepEqual(
      resolveOpsPermission('/api/platform/ops/deployments/42', 'PATCH'),
      { resourceCode: 'ops.deployments', requiredAction: 'deploy' }
    )
  })

  test('部署读取仍要求 deployments/view', () => {
    assert.deepEqual(
      resolveOpsPermission('/api/platform/ops/deployments', 'GET'),
      { resourceCode: 'ops.deployments', requiredAction: 'view' }
    )
  })
})
