import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolveAssetsApiPermission } from '../server/utils/assetsPermissionRoutes.ts'

function dataRuntimeSource(path: string) {
  return readFileSync(new URL(`../../data-runtime/internal/apps/assets/${path}`, import.meta.url), 'utf8')
}

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

function section(content: string, start: string, end: string) {
  const startIndex = content.indexOf(start)
  const endIndex = content.indexOf(end, startIndex + start.length)

  assert.notEqual(startIndex, -1, `Missing ${start}`)
  assert.notEqual(endIndex, -1, `Missing ${end}`)
  return content.slice(startIndex, endIndex)
}

describe('resolveAssetsApiPermission 敏感动作映射', () => {
  test('工作台快捷入口使用应用内规范路由，不重复部署前缀', () => {
    const dashboard = dataRuntimeSource('runtime_reads.go')

    assert.match(dashboard, /"to": "\/physical"/)
    assert.match(dashboard, /"to": "\/resources"/)
    assert.match(dashboard, /"to": "\/products"/)
    assert.doesNotMatch(dashboard, /"to": "\/assets\/(?:physical|resources|products)"/)
  })

  test('资产总览与环境视图使用独立页面和对应权限', () => {
    const config = source('app/config/permissions.ts')
    const overviewPage = source('app/pages/overview.vue')

    assert.match(config, /label: '资产总览'[\s\S]{0,160}to: '\/overview'[\s\S]{0,100}resource: 'reports'/)
    assert.match(config, /label: '环境视图'[\s\S]{0,160}to: '\/environments'[\s\S]{0,100}resource: 'environments'/)
    assert.match(config, /pattern: '\/overview'[\s\S]{0,100}resource: 'reports'/)
    assert.match(overviewPage, /usePageTitle\('资产总览'\)/)
    assert.match(overviewPage, /\/api\/v1\/reports\/assets-summary/)
  })

  test('客户交付资产目标页复用 deliveries 权限并由 runtime 执行责任数据范围', () => {
    assert.deepEqual(
      resolveAssetsApiPermission('customer-delivery-assets/CDA-001', 'GET'),
      { resource: 'deliveries', action: 'view' }
    )
    assert.deepEqual(
      resolveAssetsApiPermission('customer-delivery-assets/CDA-001', 'PATCH'),
      { resource: 'deliveries', action: 'edit' }
    )
  })

  test('离职回收列表、详情与责任修改分别要求专用 view/edit 权限', () => {
    assert.deepEqual(
      resolveAssetsApiPermission('offboarding-recoveries', 'GET'),
      { resource: 'offboarding_recoveries', action: 'view' }
    )
    assert.deepEqual(
      resolveAssetsApiPermission('offboarding-recoveries/AOR-001', 'GET'),
      { resource: 'offboarding_recoveries', action: 'view' }
    )
    assert.deepEqual(
      resolveAssetsApiPermission('offboarding-recoveries/AOR-001', 'PATCH'),
      { resource: 'offboarding_recoveries', action: 'edit' }
    )

    const config = source('app/config/permissions.ts')
    const manifest = source('app.manifest.json')
    const middleware = source('server/middleware/tenant-runtime.ts')
    const listPage = source('app/pages/offboarding-recoveries/index.vue')
    const detailPage = source('app/pages/offboarding-recoveries/[caseCode].vue')
    assert.match(config, /code: 'offboarding_recoveries'[\s\S]{0,180}actions: \['view', 'edit', 'admin'\]/)
    assert.match(config, /to: '\/offboarding-recoveries'[\s\S]{0,100}resource: 'offboarding_recoveries'/)
    assert.match(config, /pattern: '\/offboarding-recoveries\/\*\*'[\s\S]{0,100}resource: 'offboarding_recoveries'/)
    assert.match(manifest, /"code": "offboarding_recoveries"[\s\S]{0,220}"actions": \["view", "edit", "admin"\]/)
    assert.match(manifest, /"assets:offboarding_recoveries:admin"/)
    assert.match(middleware, /context\.method === 'GET' \? 'assets\.read' : 'assets\.write'/)
    assert.match(listPage, /\/api\/v1\/offboarding-recoveries/)
    assert.match(detailPage, /method: 'PATCH'/)
    assert.match(detailPage, /hasPermission\('offboarding_recoveries', 'edit'\)/)
    assert.match(detailPage, /v-if="canEditRecovery"/)
    assert.match(detailPage, /exclude-uids="\[recovery\.departed_employee_uid\]"/)
  })

  test('普通字典读取不经过 Assets BFF 权限守卫', () => {
    assert.equal(resolveAssetsApiPermission('dictionaries', 'GET'), null)
    assert.equal(resolveAssetsApiPermission('dictionaries/', 'GET'), null)
    assert.equal(resolveAssetsApiPermission('dictionaries', 'HEAD'), null)
    assert.equal(resolveAssetsApiPermission('dictionaries', 'OPTIONS'), null)
  })

  test('实例职责冲突解释按目标对象要求对应审批权限', () => {
    assert.deepEqual(
      resolveAssetsApiPermission('authorization/instance-conflict-explain', 'POST', '', '', 'purchase_order'),
      { resource: 'purchase_orders', action: 'approve' }
    )
    assert.deepEqual(
      resolveAssetsApiPermission('authorization/instance-conflict-explain', 'POST', '', '', 'assignment'),
      { resource: 'assignments', action: 'approve' }
    )
  })

  test('跨应用操作诊断与重放使用专用 tenant-global 权限且保持本地 BFF 边界', () => {
    assert.deepEqual(
      resolveAssetsApiPermission('integration-operations', 'GET'),
      { resource: 'integration_operations', action: 'view' }
    )
    assert.deepEqual(
      resolveAssetsApiPermission('integration-operations/550e8400-e29b-41d4-a716-446655440070/attempts', 'GET'),
      { resource: 'integration_operations', action: 'view' }
    )
    assert.deepEqual(
      resolveAssetsApiPermission('integration-operations/550e8400-e29b-41d4-a716-446655440070/replay', 'POST'),
      { resource: 'integration_operations', action: 'replay' }
    )

    const manifest = source('app.manifest.json')
    const middleware = source('server/middleware/tenant-runtime.ts')
    const admin = source('server/utils/integrationOperationAdmin.ts')
    const page = source('app/pages/integration-operations.vue')
    assert.match(manifest, /"code": "integration_operations"[\s\S]{0,220}"actions": \["view", "replay"\]/)
    assert.match(manifest, /"assets:integration_operations:view"/)
    assert.match(manifest, /"assets:integration_operations:replay"/)
    assert.match(middleware, /\^\\\/integration-operations\(\?:\\\/\[\^\/\]\+\\\/\(\?:replay\|attempts\)\)\?\$\//)
    assert.match(admin, /hasTenantGlobalIntegrationOperationGrant/)
    assert.match(admin, /appCode: 'assets'/)
    assert.match(admin, /assets:integration_operations:\$\{action\}/)
    assert.match(page, /source-app="assets"/)
  })

  test('后台字典维护仍要求 admin/admin', () => {
    assert.deepEqual(
      resolveAssetsApiPermission('admin/dictionaries/asset_status', 'PUT'),
      { resource: 'admin', action: 'admin' }
    )
  })

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

  test('本人领用、归还和释放使用 assignments/request，管理动作仍要求 edit', () => {
    for (const actionType of ['claim', 'return', 'release']) {
      assert.deepEqual(
        resolveAssetsApiPermission('assignments', 'POST', '', actionType),
        { resource: 'assignments', action: 'request' }
      )
    }
    assert.deepEqual(
      resolveAssetsApiPermission('assignments', 'POST', '', 'assign'),
      { resource: 'assignments', action: 'edit' }
    )
    assert.deepEqual(
      resolveAssetsApiPermission('assignments', 'POST', '', 'transfer'),
      { resource: 'assignments', action: 'edit' }
    )
    assert.deepEqual(
      resolveAssetsApiPermission('assignments', 'POST', '', 'scrap'),
      { resource: 'assignments', action: 'edit' }
    )
  })

  test('permission middleware derives assignment action and conflict target from the body', () => {
    const middleware = source('server/middleware/assets-permission.ts')
    assert.match(middleware, /action_type/)
    assert.match(middleware, /targetType/)
    assert.match(middleware, /resolveAssetsApiPermission\(path, method, metadata\.status, metadata\.actionType, metadata\.targetType\)/)
  })

  test('资产操作创建路径不能直接写入已生效终态', () => {
    const content = dataRuntimeSource('runtime_writes.go')

    assert.match(content, /func assignmentCreateStatus/)
    assert.match(content, /asset_assignment_status_requires_workflow/)
    assert.doesNotMatch(content, /applyAssignmentEffect\(ctx,\s*tx,\s*assetID/)
  })

  test('采购单普通写入路径不能直接写入审批状态或 workflow 实例', () => {
    const content = dataRuntimeSource('runtime_writes.go')
    const createPurchaseOrder = section(content, 'func (a *Adapter) createPurchaseOrder', 'func (a *Adapter) updatePurchaseOrder')
    const updatePurchaseOrder = section(content, 'func (a *Adapter) updatePurchaseOrder', 'func purchaseOrderCreateStatus')

    assert.match(content, /func purchaseOrderCreateStatus/)
    assert.match(content, /asset_purchase_order_status_requires_workflow/)
    assert.match(content, /asset_purchase_order_workflow_requires_submit/)
    assert.doesNotMatch(createPurchaseOrder, /coalesceText\(body,\s*"status",\s*"draft"\)/)
    assert.doesNotMatch(createPurchaseOrder, /nullableBodyText\(body,\s*"workflow_instance_id"\)/)
    assert.doesNotMatch(updatePurchaseOrder, /status\s*=\s*COALESCE/)
    assert.doesNotMatch(updatePurchaseOrder, /workflow_instance_id\s*=/)
  })

  test('采购单创建和编辑表单不提交普通状态字段', () => {
    for (const path of [
      'app/components/assets/PurchaseOrderCreateModal.vue',
      'app/components/assets/PurchaseOrderEditModal.vue'
    ]) {
      const content = source(path)

      assert.doesNotMatch(content, /purchaseStatusOptions/)
      assert.doesNotMatch(content, /status:\s*state\.status/)
      assert.doesNotMatch(content, /v-model="state\.status"/)
    }
  })
})
