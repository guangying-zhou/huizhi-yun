import test from 'node:test'
import assert from 'node:assert/strict'
import { reviewEnvironmentPolicy } from '../server/utils/environmentPolicyReview.ts'
import { diffEnvironmentPolicy, pinHash, projectEnvironmentReleaseFacts, type EnvironmentAppSelection } from '../server/utils/environmentAppReleaseModel.ts'
import { rolePermissionGrantId } from '../server/utils/policyBundleV2.ts'

const action = { appCode: 'finance', resourceCode: 'payments', action: 'approve' }
const grant = { ...action, roleCode: 'reviewer', sourceType: 'custom', appRoleCode: null, sourceManifestActionId: 1, status: 'active' }
const row = (id: number) => {
  const r = { ...grant, sourceManifestActionId: id }
  return { ...r, grantId: rolePermissionGrantId(r) }
}
const payload = (id: number) => ({ manifestActions: [action], rolePermissionGrants: [row(id)] })
test('source renumbering has zero row behavior changes but full diff and hash remain different', () => {
  const before = payload(1), after = payload(2)
  const review = reviewEnvironmentPolicy(before, after)
  assert.equal(review.equivalent.length, 1)
  assert.equal(review.equivalent[0]!.behaviorChanges, 0)
  assert.deepEqual(review.real, [])
  assert.equal(diffEnvironmentPolicy(before, after).length, 1)
  assert.notEqual(pinHash(before), pinHash(after))
  assert.deepEqual(review.equivalent[0]!.before, before.rolePermissionGrants[0])
})
test('no equivalence for scope widening, missing catalog, changed source/role/status, forged grant IDs or unknown fields', () => {
  for (const change of [{ sourceType: 'app_role' }, { roleCode: 'other' }, { status: 'inactive' }, { scopeValue: 'global' }, { grantId: 'forged' }, { sourceManifestActionId: null }]) {
    const after = payload(2)
    Object.assign(after.rolePermissionGrants[0]!, change)
    assert.equal(reviewEnvironmentPolicy(payload(1), after).equivalent.length, 0)
  }
  assert.equal(reviewEnvironmentPolicy({ ...payload(1), manifestActions: [] }, payload(2)).equivalent.length, 0)
  const scope = { ...grant, scopeType: 'project', scopeValue: 'member' }
  const before = { manifestActions: [action], roleDefaultScopes: [scope] }
  const after = { manifestActions: [action], roleDefaultScopes: [{ ...scope, sourceManifestActionId: 2, scopeValue: 'global' }] }
  const review = reviewEnvironmentPolicy(before, after)
  assert.equal(review.equivalent.length, 0)
  assert.equal(review.real[0]!.origin, 'governance')
})
test('current governance is visible independently of release changes; selection provenance is not discarded', () => {
  const review = reviewEnvironmentPolicy({ ...payload(1), subjects: [{ subjectCode: 'fixture', status: 'active' }] }, { ...payload(2), subjects: [{ subjectCode: 'fixture', status: 'disabled' }], appReleaseSelection: { revision: 2 } })
  assert.equal(review.real[0]!.field, 'subjects')
  assert.equal(review.real[0]!.origin, 'governance')
  assert.equal(review.provenance[0]!.field, 'appReleaseSelection')
  assert.equal(review.equivalent.length, 1)
})
test('tenant mapping is authoritative for system roles too; empty or disabled mapping never resurrects from template or baseline', () => {
  const release = { appCode: 'finance', releaseId: 1, releaseVersion: 'v1', sourceTag: 'finance/v1', manifestId: 1, manifestHash: 'h', resources: [], actions: [{ ...action, id: 1 }], manifest: { recommendedRoles: [{ code: 'finance:approver', name: 'Approver', suggestedPermissions: ['finance:payments:approve'] }] } }
  const selection: EnvironmentAppSelection = { revision: 1, sourceBundleId: 1, sourceBundleHash: 'h', baseline: null, pins: [{ appCode: 'finance', releaseId: 1 }], releases: [release] }
  const mapping = { roleCode: 'manager', appRoleCode: 'finance:approver', sourceSystemRoleCode: 'template', sortOrder: 9 }
  const facts = { roles: [{ roleCode: 'manager', status: 'active', source: 'system', sourceRoleCode: 'template', isOverridden: 0 }], roleAppRoleMaps: [mapping], systemAppRoleMaps: [], applications: [] }
  assert.deepEqual(projectEnvironmentReleaseFacts(facts, selection).roleAppRoleMaps, [mapping])
  const defaults = [{ systemRoleCode: 'template', appRoleCode: 'finance:approver' }]
  assert.deepEqual(projectEnvironmentReleaseFacts({ ...facts, roleAppRoleMaps: [], systemAppRoleMaps: defaults }, selection).roleAppRoleMaps, [])
  assert.deepEqual(projectEnvironmentReleaseFacts({ ...facts, roles: [{ ...facts.roles[0], status: 'disabled' }] }, selection).rolePermissions, [])
})

test('legacy null scope provenance may be filled without changing scope or owning action', () => {
  const scope = { ...grant, scopeType: 'project', scopeValue: 'member', sourceManifestActionId: null }
  const review = reviewEnvironmentPolicy({ manifestActions: [action], roleDefaultScopes: [scope] }, { manifestActions: [action], roleDefaultScopes: [{ ...scope, sourceManifestActionId: 9 }] })
  assert.equal(review.equivalent.length, 1)
  assert.deepEqual(review.real, [])
})
