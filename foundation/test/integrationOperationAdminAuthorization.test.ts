import assert from 'node:assert/strict'
import test from 'node:test'
import { hasTenantGlobalIntegrationOperationGrant } from '../server/utils/integrationOperationAdminAuthorization'

const requirement = { appCode: 'aims', action: 'view' as const }

function grant(scopes: Array<{ dimension: string, predicate: string }> = []) {
  return {
    grantId: 'grant-1',
    permissions: [{ appCode: 'aims', resourceCode: 'integration_operations', action: 'view' }],
    assignmentScopes: scopes
  }
}

test('跨应用操作管理接受无对象限制或显式租户全局授权', () => {
  assert.equal(hasTenantGlobalIntegrationOperationGrant([grant()], requirement), true)
  assert.equal(hasTenantGlobalIntegrationOperationGrant([
    grant([{ dimension: 'tenant', predicate: 'global' }])
  ], requirement), true)
})

test('跨应用操作管理拒绝项目、部门或混合范围授权', () => {
  assert.equal(hasTenantGlobalIntegrationOperationGrant([
    grant([{ dimension: 'project', predicate: 'member' }])
  ], requirement), false)
  assert.equal(hasTenantGlobalIntegrationOperationGrant([{
    ...grant([{ dimension: 'tenant', predicate: 'global' }]),
    defaultScopes: [{ dimension: 'department', predicate: 'tree' }]
  }], requirement), false)
})

test('跨应用操作管理严格匹配应用、资源和动作', () => {
  assert.equal(hasTenantGlobalIntegrationOperationGrant([{
    ...grant(),
    permissions: [{ appCode: 'altoc', resourceCode: 'integration_operations', action: 'view' }]
  }], requirement), false)
  assert.equal(hasTenantGlobalIntegrationOperationGrant([{
    ...grant(),
    permissions: [{ appCode: 'aims', resourceCode: 'integration_operations', action: 'replay' }]
  }], requirement), false)
})
