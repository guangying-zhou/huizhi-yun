import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveAssetsApiPermission } from '../server/utils/assetsPermissionRoutes.ts'

describe('resolveAssetsApiPermission 敏感动作映射', () => {
  test('采购审批回写要求 purchase_orders/approve', () => {
    assert.deepEqual(
      resolveAssetsApiPermission('purchase-orders/42/workflow:sync', 'POST', 'approved'),
      { resource: 'purchase_orders', action: 'approve' }
    )
  })

  test('普通采购提交仍要求 purchase_orders/edit', () => {
    assert.deepEqual(
      resolveAssetsApiPermission('purchase-orders/42/submit', 'POST'),
      { resource: 'purchase_orders', action: 'edit' }
    )
  })

  test('资产操作审批回写要求 assignments/approve', () => {
    assert.deepEqual(
      resolveAssetsApiPermission('assignments/7/workflow:sync', 'POST', 'approved'),
      { resource: 'assignments', action: 'approve' }
    )
  })

  test('直接创建已生效资产操作要求 assignments/approve', () => {
    assert.deepEqual(
      resolveAssetsApiPermission('assignments', 'POST', 'active'),
      { resource: 'assignments', action: 'approve' }
    )
  })

  test('默认创建待处理资产操作仍要求 assignments/edit', () => {
    assert.deepEqual(
      resolveAssetsApiPermission('assignments', 'POST'),
      { resource: 'assignments', action: 'edit' }
    )
  })
})
