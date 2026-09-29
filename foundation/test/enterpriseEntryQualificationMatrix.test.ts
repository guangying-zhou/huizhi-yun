import assert from 'node:assert/strict'
import test from 'node:test'
import { createEnterpriseEntitlementRepository, type EnterpriseTransaction } from '../../platform/server/utils/enterpriseEntitlementRepository.ts'
import { evaluateEnterpriseEntitlement, enterpriseModuleAvailability } from '../../console/server/utils/enterpriseEntitlement.ts'
import { buildAllowedAppCodesFromPolicyBundle } from '../server/utils/applicationAuthorization.ts'
import { classifyApplicationAccessIssue } from '../app/composables/useApiErrorAlert.ts'

const tenantCode = 'tenant-matrix'
const now = '2026-09-15T12:00:00Z'

function activePayload() {
  return {
    enterpriseEntitlement: {
      schemaVersion: 'enterprise-entitlement.v1', productCode: 'enterprise-full', tenantCode, revision: 1,
      status: 'active', effectiveStatus: 'active', effectiveFrom: '2026-01-01T00:00:00Z',
      end: { kind: 'finite', effectiveUntil: '2027-01-01T00:00:00Z' }
    },
    moduleAvailability: [{ appCode: 'aims', deploymentState: 'deployed', configurationState: 'configured' }],
    subjects: [{ subjectType: 'user', subjectCode: 'subject-u1', externalRef: 'u1', status: 'active' }],
    roles: [],
    roleAssignments: [],
    rolePermissionGrants: [],
    baselineGrants: []
  }
}

function previewRepository(planCode: string) {
  const statements: string[] = []
  const transaction: EnterpriseTransaction = async work => work({
    queryRow: async (sql: string) => {
      statements.push(sql)
      if (sql.includes('FROM tenants ')) return { tenant_code: tenantCode, status: 'active' }
      if (sql.includes('tenant_enterprise_entitlement_current')) return null
      if (sql.includes('tenant_enterprise_entitlement_migrations')) return null
      throw new Error(`unexpected query: ${sql}`)
    },
    queryRows: async (sql: string) => {
      statements.push(sql)
      if (sql.includes('FROM tenant_subscriptions')) return [{ id: 1, status: 'active', started_at: '2026-01-01 00:00:00', ended_at: '2027-01-01 00:00:00', current_order_id: null, plan_code: planCode }]
      if (sql.includes('FROM platform_orders')) return [{ id: 71, status: 'paid', effective_from: '2024-01-01 00:00:00', effective_until: '2025-01-01 00:00:00', plan_code: 'retained-historical-order' }]
      return []
    },
    execute: async () => {
      throw new Error('dry-run preview must not write')
    }
  } as never)
  return { repo: createEnterpriseEntitlementRepository(transaction), statements }
}

test('enterprise entry qualification matrix stays read-only and separates enterprise access from personnel grants', async () => {
  for (const planCode of ['legacy-standard', 'legacy-pro']) {
    const { repo, statements } = previewRepository(planCode)
    const preview = await repo.preview({ tenantCode, migrationId: `preview-${planCode}` }, now)

    assert.equal(preview.result.decision, 'ready')
    assert.equal(preview.result.entitlement?.productCode, 'enterprise-full')
    assert.equal(preview.result.sourceReport.sources.find(source => source.sourceId === 'tenant-subscription:1')?.planCode, planCode)
    assert.ok(preview.result.historicalIds.includes('order:71'))
    assert.ok(statements.every(sql => sql.startsWith('SELECT') && !sql.includes('FOR UPDATE')))
  }

  const active = activePayload()
  assert.equal(evaluateEnterpriseEntitlement(active, tenantCode, Date.parse(now)).allowed, true)
  assert.equal(enterpriseModuleAvailability(active, 'aims')?.availabilityCode, null)
  const noPersonnelGrant = buildAllowedAppCodesFromPolicyBundle({ payload: active, uid: 'u1' })
  assert.equal(noPersonnelGrant.hasActiveUserSubject, true)
  assert.deepEqual(noPersonnelGrant.selectedRoleCodes, [])
  assert.deepEqual([...noPersonnelGrant.allowedAppCodes], [])

  const suspended = activePayload()
  suspended.enterpriseEntitlement.status = 'suspended'
  suspended.enterpriseEntitlement.effectiveStatus = 'suspended'
  assert.deepEqual(evaluateEnterpriseEntitlement(suspended, tenantCode, Date.parse(now)), {
    mode: 'enterprise', allowed: false, reason: 'enterprise_entitlement_inactive'
  })
  assert.equal(classifyApplicationAccessIssue({ statusCode: 403, data: { code: 'enterprise_entitlement_inactive' } }), 'enterprise_entitlement_inactive')

  const expired = activePayload()
  expired.enterpriseEntitlement.status = 'expired'
  expired.enterpriseEntitlement.effectiveStatus = 'expired'
  expired.enterpriseEntitlement.end.effectiveUntil = '2026-09-01T00:00:00Z'
  assert.deepEqual(evaluateEnterpriseEntitlement(expired, tenantCode, Date.parse(now)), {
    mode: 'enterprise', allowed: false, reason: 'enterprise_entitlement_inactive'
  })

  const unconfigured = activePayload()
  unconfigured.moduleAvailability[0]!.configurationState = 'not-configured'
  assert.equal(enterpriseModuleAvailability(unconfigured, 'aims')?.availabilityCode, 'module_not_configured')
  assert.equal(classifyApplicationAccessIssue({ statusCode: 503, data: { code: 'module_not_configured' } }), 'module_not_configured')

  const undeployed = activePayload()
  undeployed.moduleAvailability[0]!.deploymentState = 'not-deployed'
  assert.equal(enterpriseModuleAvailability(undeployed, 'aims')?.availabilityCode, 'module_not_deployed')
  assert.equal(classifyApplicationAccessIssue({ statusCode: 503, data: { code: 'module_not_deployed' } }), 'module_not_deployed')
  assert.equal(classifyApplicationAccessIssue({ statusCode: 503, message: 'Enterprise runtime unavailable' }), 'service_unavailable')
})
