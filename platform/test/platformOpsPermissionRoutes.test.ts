import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolveOpsPermission } from '../server/utils/platformOpsPermissionRoutes.ts'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

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

  test('发票与付款列表归属订阅权限域', () => {
    assert.deepEqual(
      resolveOpsPermission('/api/platform/ops/invoices', 'GET'),
      { resourceCode: 'ops.subscriptions', requiredAction: 'view' }
    )
    assert.deepEqual(
      resolveOpsPermission('/api/platform/ops/payments', 'GET'),
      { resourceCode: 'ops.subscriptions', requiredAction: 'view' }
    )
  })

  test('应用版本发布要求 applications/release', () => {
    assert.deepEqual(
      resolveOpsPermission('/api/platform/ops/applications/altoc/releases/42', 'PATCH'),
      { resourceCode: 'ops.applications', requiredAction: 'release' }
    )
    assert.deepEqual(
      resolveOpsPermission('/api/platform/admin/applications/altoc/releases/42', 'PATCH'),
      { resourceCode: 'ops.applications', requiredAction: 'release' }
    )
  })

  test('Ops 超级管理员种子包含应用发布敏感动作', () => {
    const content = source('server/utils/platformOpsRbac.ts')
    assert.match(content, /'ops\.applications':\s*\['view', 'edit', 'admin', 'release'\]/)
  })

  test('普通应用写入仍要求 applications/edit', () => {
    assert.deepEqual(
      resolveOpsPermission('/api/platform/ops/applications/altoc', 'PATCH'),
      { resourceCode: 'ops.applications', requiredAction: 'edit' }
    )
  })

  test('默认登录权限治理归属 roles 权限域', () => {
    assert.deepEqual(
      resolveOpsPermission('/api/platform/ops/baseline-permissions', 'GET'),
      { resourceCode: 'ops.roles', requiredAction: 'view' }
    )
    assert.deepEqual(
      resolveOpsPermission('/api/platform/ops/baseline-permissions', 'PUT'),
      { resourceCode: 'ops.roles', requiredAction: 'edit' }
    )
  })

  test('平台账号与平台角色归属角色治理权限域', () => {
    assert.deepEqual(
      resolveOpsPermission('/api/platform/ops/accounts', 'GET'),
      { resourceCode: 'ops.roles', requiredAction: 'view' }
    )
    assert.deepEqual(
      resolveOpsPermission('/api/platform/ops/platform-roles', 'GET'),
      { resourceCode: 'ops.roles', requiredAction: 'view' }
    )
  })

  test('平台运营辅助列表归属控制台权限域', () => {
    for (const segment of ['tickets', 'announcements', 'feature-flags', 'audit']) {
      assert.deepEqual(
        resolveOpsPermission(`/api/platform/ops/${segment}`, 'GET'),
        { resourceCode: 'ops.console', requiredAction: 'view' }
      )
    }
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
    assert.deepEqual(
      resolveOpsPermission('/api/platform/ops/runtime-releases/approve', 'POST'),
      { resourceCode: 'ops.deployments', requiredAction: 'deploy' }
    )
  })

  test('租户策略包生成要求 deployments/deploy', () => {
    assert.deepEqual(
      resolveOpsPermission('/api/platform/ops/tenants/C000001/bundles', 'POST'),
      { resourceCode: 'ops.deployments', requiredAction: 'deploy' }
    )
    assert.deepEqual(
      resolveOpsPermission('/api/platform/admin/tenants/C000001/bundles', 'POST'),
      { resourceCode: 'ops.deployments', requiredAction: 'deploy' }
    )
  })

  test('普通租户写入仍要求 tenants/edit', () => {
    assert.deepEqual(
      resolveOpsPermission('/api/platform/ops/tenants/C000001', 'PATCH'),
      { resourceCode: 'ops.tenants', requiredAction: 'edit' }
    )
  })

  test('部署读取仍要求 deployments/view', () => {
    assert.deepEqual(
      resolveOpsPermission('/api/platform/ops/deployments', 'GET'),
      { resourceCode: 'ops.deployments', requiredAction: 'view' }
    )
  })
})

 test('drain evidence approval uses exact deployment admin permission', () => {
  for (const action of ['external-drain', 'drain-activity']) {
    assert.deepEqual(resolveOpsPermission(`/api/platform/ops/deployments/${action}`, 'POST'), {resourceCode:'ops.deployments', requiredAction:'admin'})
  }
 })
