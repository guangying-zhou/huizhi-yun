import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { buildPolicyBundleV2CompatFields } from '../../platform/server/utils/policyBundleV2.ts'
import {
  evaluatePolicyBundleScopedAuthorization
} from '@hzy/foundation/server/utils/applicationAuthorization'

const consolePolicyAuthorization = readFileSync(new URL('../server/utils/policyAuthorization.ts', import.meta.url), 'utf8')

function policyPayload() {
  const compatibility = buildPolicyBundleV2CompatFields({
    tenantCode: 'tenant-a',
    environment: 'test',
    subjectRoles: [
      { assignmentId: 101, subjectType: 'user', subjectCode: 'subject-u1', roleCode: 'custom-project-editor', status: 'active', startsAt: '2020-01-01T00:00:00Z' },
      { assignmentId: 102, subjectType: 'user', subjectCode: 'subject-u1', roleCode: 'expired-report-exporter', status: 'active', expiresAt: '2000-01-01T00:00:00Z' },
      { assignmentId: 103, subjectType: 'user', subjectCode: 'subject-u1', roleCode: 'future-deployer', status: 'active', startsAt: '2099-01-01T00:00:00Z' }
    ],
    subjectRoleScopes: [
      { assignmentId: 101, subjectType: 'user', subjectCode: 'subject-u1', roleCode: 'custom-project-editor', appCode: 'aims', resourceCode: 'projects', action: 'edit', scopeDimension: 'project', scopePredicate: 'member', scopeValue: 'PRJ-001', scopeMode: 'intersect', status: 'active' }
    ],
    rolePermissions: [
      { roleCode: 'custom-project-editor', appCode: 'aims', resourceCode: 'projects', action: 'edit', status: 'active' },
      { roleCode: 'expired-report-exporter', appCode: 'aims', resourceCode: 'reports', action: 'export', status: 'active' },
      { roleCode: 'future-deployer', appCode: 'aims', resourceCode: 'deployments', action: 'deploy', status: 'active' }
    ],
    roleScopes: [],
    baselinePermissions: [],
    conflictRules: []
  })

  return {
    enterpriseEntitlement: {
      schemaVersion: 'enterprise-entitlement.v1', productCode: 'enterprise-full', tenantCode: 'tenant-a', revision: 1,
      status: 'active', effectiveStatus: 'active', effectiveFrom: '2020-01-01T00:00:00Z', end: { kind: 'unlimited', evidenceReference: 'test-fixture' }
    },
    subjects: [
      { subjectType: 'user', subjectCode: 'subject-u1', externalRef: 'u1', status: 'active' },
      { subjectType: 'user', subjectCode: 'subject-u2', externalRef: 'u2', status: 'active' }
    ],
    roles: [
      { roleCode: 'custom-project-editor', roleName: 'Custom project editor', appCode: null, status: 'active', isAssignable: 1 },
      { roleCode: 'expired-report-exporter', roleName: 'Expired report exporter', appCode: null, status: 'active', isAssignable: 1 },
      { roleCode: 'future-deployer', roleName: 'Future deployer', appCode: null, status: 'active', isAssignable: 1 }
    ],
    ...compatibility
  }
}

test('enterprise-full is not a user grant; custom scoped roles honor lifecycle across Platform, Console and Foundation', () => {
  const payload = policyPayload()

  // Console's normal and scoped snapshots share this lifecycle gate. The actual
  // bundle selection runs under Nuxt aliases, so keep the wiring contract here
  // and exercise the generated payload through Foundation's shared evaluator.
  assert.match(consolePolicyAuthorization, /import \{[^}]*isRecordActiveAt[^}]*\} from '@hzy\/authz-core'/)
  assert.match(consolePolicyAuthorization, /function isActive\(record: BundleRecord\) \{\s*return isRecordActiveAt\(record\)\s*\}/)

  const allowed = evaluatePolicyBundleScopedAuthorization({
    payload,
    uid: 'u1',
    required: { appCode: 'aims', resourceCode: 'projects', action: 'view' },
    object: { actorUid: 'u1', projectCode: 'PRJ-001', projectMemberUids: ['u1'] }
  })
  assert.equal(allowed.allowed, true)
  assert.match(allowed.matchedGrantId || '', /^assignment:101:/)
  assert.deepEqual(allowed.selectedRoleCodes, ['custom-project-editor'])

  const unassigned = evaluatePolicyBundleScopedAuthorization({
    payload,
    uid: 'u2',
    required: { appCode: 'aims', resourceCode: 'projects', action: 'view' },
    object: { actorUid: 'u2', projectCode: 'PRJ-001', projectMemberUids: ['u2'] }
  })
  assert.equal(unassigned.allowed, false)
  assert.equal(unassigned.reasonCode, 'no_permission')

  const outsideProject = evaluatePolicyBundleScopedAuthorization({
    payload,
    uid: 'u1',
    required: { appCode: 'aims', resourceCode: 'projects', action: 'edit' },
    object: { actorUid: 'u1', projectCode: 'PRJ-002', projectMemberUids: ['u1'] }
  })
  assert.equal(outsideProject.allowed, false)
  assert.equal(outsideProject.reasonCode, 'scope_not_matched')

  for (const [resourceCode, action] of [['reports', 'export'], ['deployments', 'deploy']] as const) {
    const decision = evaluatePolicyBundleScopedAuthorization({
      payload,
      uid: 'u1',
      required: { appCode: 'aims', resourceCode, action },
      object: {}
    })
    assert.equal(decision.allowed, false, `${action} must not survive an inactive assignment`)
    assert.equal(decision.reasonCode, 'no_permission')
  }
})
