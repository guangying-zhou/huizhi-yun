import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  buildPolicyBundleV2CompatFields,
  normalizeManifestActionImplications,
  POLICY_BUNDLE_COMPAT_SCHEMA_VERSIONS,
  stripLegacyPolicyBundleAuthorizationFields
} from '../server/utils/policyBundleV2.ts'

describe('policy bundle v2 compatibility projection', () => {
  test('projects assignment lifecycle fields and scoped grants without mutating v1 inputs', () => {
    const v1SubjectRoles = [{
      assignmentId: 1001,
      subjectType: 'user',
      subjectCode: 'u1',
      roleCode: 'project_manager',
      assignmentKind: 'duty',
      sourceType: 'manual',
      sourceId: 'grant-1',
      grantedAt: '2026-06-01T00:00:00Z',
      startsAt: '2026-06-02T00:00:00Z',
      expiredAt: '2026-07-01T00:00:00Z',
      status: 'active'
    }]
    const v1AssignmentScopes = [{
      assignmentId: 1001,
      subjectType: 'user',
      subjectCode: 'u1',
      roleCode: 'project_manager',
      appCode: 'aims',
      resourceCode: 'projects',
      action: 'edit',
      scopeDimension: 'project',
      scopePredicate: 'member',
      scopeValue: 'PRJ-001',
      scopeGroup: 'default',
      scopeMode: 'intersect',
      status: 'active'
    }]
    const fields = buildPolicyBundleV2CompatFields({
      tenantCode: 'C000001',
      environment: 'prod',
      subjectRoles: v1SubjectRoles,
      subjectRoleScopes: v1AssignmentScopes,
      rolePermissions: [{
        roleCode: 'project_manager',
        appCode: 'aims',
        resourceCode: 'projects',
        action: 'edit',
        sourceManifestActionId: 9001,
        sourceType: 'app_role',
        appRoleCode: 'aims.project_manager',
        status: 'active'
      }],
      roleScopes: [{
        roleCode: 'project_manager',
        appCode: 'aims',
        resourceCode: 'projects',
        action: 'edit',
        scopeType: 'tenant',
        scopeValue: 'global',
        status: 'active'
      }],
      baselinePermissions: [{
        appCode: 'codocs',
        resourceCode: 'documents',
        action: 'create',
        scopeType: 'subject',
        scopeValue: 'self',
        excludedSubjectCodes: ['u-excluded']
      }],
      conflictRules: [{
        ruleCode: 'finance-expense-maker-confirmation',
        source: 'platform-default',
        status: 'active'
      }],
      policyRevision: 42
    })

    assert.deepEqual(fields.compatSchemaVersions, POLICY_BUNDLE_COMPAT_SCHEMA_VERSIONS)
    assert.equal(fields.policyRevision, 42)
    assert.deepEqual(fields.roleAssignments, [{
      assignmentId: 1001,
      subjectType: 'user',
      subjectCode: 'u1',
      roleCode: 'project_manager',
      assignmentKind: 'duty',
      sourceType: 'manual',
      sourceId: 'grant-1',
      grantedAt: '2026-06-01T00:00:00Z',
      startsAt: '2026-06-02T00:00:00Z',
      expiresAt: '2026-07-01T00:00:00Z',
      status: 'active'
    }])
    assert.deepEqual(fields.rolePermissionGrants, [{
      grantId: 'role-permission:project_manager:aims:projects:edit:app_role:aims.project_manager:9001',
      roleCode: 'project_manager',
      appCode: 'aims',
      resourceCode: 'projects',
      action: 'edit',
      sourceManifestActionId: 9001,
      sourceType: 'app_role',
      appRoleCode: 'aims.project_manager',
      status: 'active'
    }])
    assert.equal(fields.assignmentScopes[0]?.scopePredicate, 'member')
    assert.equal(fields.roleDefaultScopes[0]?.scopeType, 'tenant')
    assert.deepEqual(fields.baselineGrants, [{
      grantId: 'baseline:codocs:documents:create:subject:self',
      appCode: 'codocs',
      resourceCode: 'documents',
      action: 'create',
      scopeDimension: 'subject',
      scopePredicate: 'self',
      scopeValue: null,
      excludedSubjectCodes: ['u-excluded'],
      sourceType: 'baseline',
      status: 'active'
    }])
    assert.deepEqual(fields.conflictRules, [{
      ruleCode: 'finance-expense-maker-confirmation',
      source: 'platform-default',
      status: 'active'
    }])
    assert.equal(v1SubjectRoles[0]?.expiredAt, '2026-07-01T00:00:00Z')
  })

  test('keeps default action implications precise for sensitive actions', () => {
    const fields = buildPolicyBundleV2CompatFields({
      tenantCode: 'C000001',
      environment: 'prod',
      subjectRoles: [],
      subjectRoleScopes: [],
      roleScopes: [],
      baselinePermissions: [],
      conflictRules: []
    })

    assert.deepEqual(fields.actionImplications, [
      {
        action: 'edit',
        implies: ['view'],
        source: 'platform-default',
        scope: 'global'
      },
      {
        action: 'admin',
        implies: ['view', 'edit'],
        source: 'platform-default',
        scope: 'global'
      }
    ])
    assert.equal(fields.actionImplications.some(item => item.implies.includes('approve')), false)
    assert.equal(fields.actionImplications.some(item => item.implies.includes('confirm')), false)
    assert.equal(fields.actionImplications.some(item => item.implies.includes('export')), false)
    assert.equal(fields.actionImplications.some(item => item.implies.includes('deploy')), false)
  })

  test('adds resource-scoped manifest implications without broadening deploy', () => {
    const custom = normalizeManifestActionImplications([
      { appCode: 'webdev', resourceCode: 'webdev_workspace', action: 'execute', implies: ['view'] },
      { appCode: 'webdev', resourceCode: 'webdev_workspace', action: 'admin', implies: ['execute'] },
      { appCode: 'webdev', resourceCode: 'webdev_workspace', action: 'admin', implies: ['execute'] }
    ])

    assert.deepEqual(custom, [
      {
        appCode: 'webdev',
        resourceCode: 'webdev_workspace',
        action: 'admin',
        implies: ['execute'],
        source: 'app-manifest',
        scope: 'resource'
      },
      {
        appCode: 'webdev',
        resourceCode: 'webdev_workspace',
        action: 'execute',
        implies: ['view'],
        source: 'app-manifest',
        scope: 'resource'
      }
    ])
    assert.equal(custom.some(item => item.implies.includes('deploy')), false)
  })

  test('policyRevision is supplied by bundle generation storage state', () => {
    const base = buildPolicyBundleV2CompatFields({
      tenantCode: 'C000001',
      environment: 'prod',
      subjectRoles: [{ assignmentId: 1, subjectCode: 'u1', roleCode: 'viewer' }],
      subjectRoleScopes: [],
      roleScopes: [],
      baselinePermissions: [],
      conflictRules: [],
      policyRevision: 7
    })
    const defaulted = buildPolicyBundleV2CompatFields({
      tenantCode: 'C000001',
      environment: 'prod',
      subjectRoles: [{ assignmentId: 1, subjectCode: 'u1', roleCode: 'viewer' }],
      subjectRoleScopes: [],
      roleScopes: [],
      baselinePermissions: [],
      conflictRules: []
    })
    const invalid = buildPolicyBundleV2CompatFields({
      tenantCode: 'C000001',
      environment: 'prod',
      subjectRoles: [{ assignmentId: 1, subjectCode: 'u1', roleCode: 'viewer' }],
      subjectRoleScopes: [],
      roleScopes: [],
      baselinePermissions: [],
      conflictRules: [],
      policyRevision: -1
    })

    assert.equal(base.policyRevision, 7)
    assert.equal(defaulted.policyRevision, 0)
    assert.equal(invalid.policyRevision, 0)
  })

  test('strips replaced authorization fields while preserving v2 rolePermissionGrants', () => {
    const payload = stripLegacyPolicyBundleAuthorizationFields({
      schemaVersion: 'policy-bundle.v2',
      roleAssignments: [],
      rolePermissionGrants: [{ grantId: 'role-permission:system_admin:platform:deployments:deploy:custom::1', roleCode: 'system_admin', appCode: 'platform', resourceCode: 'deployments', action: 'deploy' }],
      assignmentScopes: [],
      roleDefaultScopes: [],
      baselineGrants: [],
      rolePermissions: [{ roleCode: 'system_admin', appCode: 'platform', resourceCode: 'deployments', action: 'deploy' }],
      subjectRoles: [{ roleCode: 'system_admin' }],
      subjectRoleScopes: [{ assignmentId: 1 }],
      roleScopes: [{ roleCode: 'system_admin' }],
      baselinePermissions: [{ appCode: 'console' }]
    })

    assert.equal('subjectRoles' in payload, false)
    assert.equal('subjectRoleScopes' in payload, false)
    assert.equal('rolePermissions' in payload, false)
    assert.equal('roleScopes' in payload, false)
    assert.equal('baselinePermissions' in payload, false)
    assert.deepEqual(payload.rolePermissionGrants, [
      { grantId: 'role-permission:system_admin:platform:deployments:deploy:custom::1', roleCode: 'system_admin', appCode: 'platform', resourceCode: 'deployments', action: 'deploy' }
    ])
  })
})
