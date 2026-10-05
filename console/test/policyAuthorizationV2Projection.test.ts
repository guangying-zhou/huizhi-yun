import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../server/utils/policyAuthorization.ts', import.meta.url), 'utf8')
const scopedSource = readFileSync(new URL('../server/utils/policyScopedAuthorization.ts', import.meta.url), 'utf8')

function assertBefore(left: string, right: string) {
  const leftIndex = source.indexOf(left)
  const rightIndex = source.indexOf(right)

  assert.notEqual(leftIndex, -1, `missing ${left}`)
  assert.notEqual(rightIndex, -1, `missing ${right}`)
  assert.ok(leftIndex < rightIndex, `${left} must appear before ${right}`)
}

test('policyAuthorization uses v2 role assignments before v1 subject roles', () => {
  assert.match(source, /preferredRecords\(payload, 'roleAssignments', 'subjectRoles'\)/)
  assert.match(source, /for \(const subjectRole of roleAssignmentRecords\(payload\)\)/)
  assertBefore('roleAssignmentRecords(payload)', 'addRole(roleSources, stringValue(subjectRole.roleCode), \'direct\')')
})

test('policyAuthorization inherits active department and job subject memberships', () => {
  assert.match(source, /records\(payload\.subjectMemberships\)/)
  assert.match(source, /containerSubjectType = stringValue\(membership\.containerSubjectType\)/)
  assert.match(source, /\['department', 'job'\]\.includes\(containerSubjectType\)/)
  assert.match(source, /effectiveSubjectKeys\.has\(subjectKey\(subjectRole\.subjectType, subjectRole\.subjectCode\)\)/)
  assert.match(source, /effectiveSubjectKeys\.has\(subjectKey\(binding\.subjectType, binding\.subjectCode\)\)/)
  assert.match(source, /effectiveSubjectKeys\.has\(subjectKey\(override\.subjectType, override\.subjectCode\)\)/)
})

test('policyAuthorization uses v2 baseline grants before v1 baseline permissions', () => {
  assert.match(source, /preferredRecords\(payload, 'baselineGrants', 'baselinePermissions'\)/)
  assert.match(source, /for \(const permission of baselineGrantRecords\(payload\)\)/)
})

test('policyAuthorization uses v2 role permission grants before v1 role permissions', () => {
  assert.match(source, /preferredRecords\(payload, 'rolePermissionGrants', 'rolePermissions'\)/)
  assert.match(source, /for \(const permission of rolePermissionGrantRecords\(payload\)\)/)
})

test('policyAuthorization exposes v2 policyRevision on snapshots', () => {
  assert.match(source, /function policyRevisionFromPayload\(payload: Record<string, unknown>\)/)
  assert.match(source, /policyRevision: policyRevisionFromPayload\(payload\)/)
})

test('policyAuthorization uses v2 actionImplications for flat snapshot checks', () => {
  assert.match(source, /buildPolicyBundleActionPolicy\(snapshot\.payload, defaultAppCode, resourceCode\)/)
  assert.match(source, /actionSatisfies\(held, action, actionPolicy\)/)
})

test('policyScopedAuthorization consumes v2 actionImplications for scoped decisions', () => {
  assert.match(scopedSource, /buildPolicyBundleActionPolicy\(snapshot\.payload \|\| \{\}, appCode, resourceCode\)/)
  assert.match(scopedSource, /filterGrants\(grantResult\.grants, appCode, resourceCode, action, actionPolicy\)/)
  assert.match(scopedSource, /policyOf: actionPolicy \? \(\) => actionPolicy : undefined/)
})
