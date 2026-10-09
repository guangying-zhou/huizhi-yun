import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import {
  authorizationObjectContextFromQuery,
  authorizationQueryBooleanValue,
  authorizationQueryValue
} from '../server/utils/authorizationObjectContext.ts'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

describe('tenant-admin authorization object context', () => {
  test('parses shared object context fields for authorization diagnostics', () => {
    const object = authorizationObjectContextFromQuery({
      ownerUid: 'owner-1',
      departmentCode: 'dept-sales',
      departmentTree: 'dept-root, dept-sales',
      projectCode: 'PRJ-001',
      projectMemberUids: 'u1,u2',
      customerOwnerUid: 'u1',
      customerTeamUids: 'u1,u3',
      assignedUid: 'u1',
      assignedUids: 'u1,u4',
      matchedRelations: 'relation:participant,project:member',
      environment: 'prod',
      deploymentEnvironment: 'prod-cn'
    }, 'u1')

    assert.deepEqual(object, {
      actorUid: 'u1',
      ownerUid: 'owner-1',
      departmentCode: 'dept-sales',
      departmentTree: ['dept-root', 'dept-sales'],
      projectCode: 'PRJ-001',
      projectMemberUids: ['u1', 'u2'],
      customerOwnerUid: 'u1',
      customerTeamUids: ['u1', 'u3'],
      assignedUid: 'u1',
      assignedUids: ['u1', 'u4'],
      matchedRelations: ['relation:participant', 'project:member'],
      environment: 'prod',
      deploymentEnvironment: 'prod-cn'
    })
  })

  test('omits empty object context and keeps existing query parsing semantics', () => {
    assert.equal(authorizationObjectContextFromQuery({}, 'u1'), undefined)
    assert.equal(authorizationQueryValue([' role_simulation ']), 'role_simulation')
    assert.equal(authorizationQueryBooleanValue('false', true), false)
    assert.equal(authorizationQueryBooleanValue(undefined, true), true)
  })

  test('tenant-admin explain APIs share the same object context parser', () => {
    const authorizationExplain = source('server/api/platform/tenant-admin/authorization-explain.get.ts')
    const instanceConflictExplain = source('server/api/platform/tenant-admin/instance-conflict-explain.get.ts')

    for (const content of [authorizationExplain, instanceConflictExplain]) {
      assert.match(content, /authorizationObjectContextFromQuery\(query, uid\)/)
      assert.doesNotMatch(content, /function objectContextFromQuery/)
    }
  })

  test('management UIs pass environment context to explain APIs', () => {
    const authorizations = source('app/components/console/AuthorizationsManager.vue')
    const permissionDiagnostics = source('app/components/console/AuthorizationPermissionDiagnostics.vue')
    const instanceConflictDiagnostics = source('app/components/console/AuthorizationInstanceConflictDiagnostics.vue')
    const memberPermissions = source('app/components/console/MemberPermissionsManager.vue')

    assert.match(authorizations, /environment: authorizationExplainForm\.environment\.trim\(\) \|\| undefined/)
    assert.match(authorizations, /deploymentEnvironment: authorizationExplainForm\.deploymentEnvironment\.trim\(\) \|\| undefined/)
    assert.match(authorizations, /customerOwnerUid: authorizationExplainForm\.customerOwnerUid\.trim\(\) \|\| undefined/)
    assert.match(authorizations, /customerTeamUids: authorizationExplainForm\.customerTeamUids\.trim\(\) \|\| undefined/)
    assert.match(authorizations, /assignedUid: authorizationExplainForm\.assignedUid\.trim\(\) \|\| undefined/)
    assert.match(authorizations, /assignedUids: authorizationExplainForm\.assignedUids\.trim\(\) \|\| undefined/)
    assert.match(authorizations, /environment: instanceConflictForm\.environment\.trim\(\) \|\| undefined/)
    assert.match(authorizations, /deploymentEnvironment: instanceConflictForm\.deploymentEnvironment\.trim\(\) \|\| undefined/)
    assert.match(authorizations, /customerOwnerUid: instanceConflictForm\.customerOwnerUid\.trim\(\) \|\| undefined/)
    assert.match(authorizations, /customerTeamUids: instanceConflictForm\.customerTeamUids\.trim\(\) \|\| undefined/)
    assert.match(authorizations, /assignedUid: instanceConflictForm\.assignedUid\.trim\(\) \|\| undefined/)
    assert.match(authorizations, /assignedUids: instanceConflictForm\.assignedUids\.trim\(\) \|\| undefined/)
    assert.match(permissionDiagnostics, /v-model="form\.environment"/)
    assert.match(permissionDiagnostics, /v-model="form\.customerOwnerUid"/)
    assert.match(permissionDiagnostics, /v-model="form\.customerTeamUids"/)
    assert.match(permissionDiagnostics, /v-model="form\.assignedUid"/)
    assert.match(permissionDiagnostics, /v-model="form\.assignedUids"/)
    assert.match(instanceConflictDiagnostics, /v-model="form\.environment"/)
    assert.match(instanceConflictDiagnostics, /v-model="form\.customerOwnerUid"/)
    assert.match(instanceConflictDiagnostics, /v-model="form\.customerTeamUids"/)
    assert.match(instanceConflictDiagnostics, /v-model="form\.assignedUid"/)
    assert.match(instanceConflictDiagnostics, /v-model="form\.assignedUids"/)

    assert.match(memberPermissions, /environment: explainForm\.environment\.trim\(\) \|\| undefined/)
    assert.match(memberPermissions, /deploymentEnvironment: explainForm\.deploymentEnvironment\.trim\(\) \|\| undefined/)
    assert.match(memberPermissions, /departmentTree: explainForm\.departmentTree\.trim\(\) \|\| undefined/)
    assert.match(memberPermissions, /projectMemberUids: explainForm\.projectMemberUids\.trim\(\) \|\| undefined/)
    assert.match(memberPermissions, /customerOwnerUid: explainForm\.customerOwnerUid\.trim\(\) \|\| undefined/)
    assert.match(memberPermissions, /customerTeamUids: explainForm\.customerTeamUids\.trim\(\) \|\| undefined/)
    assert.match(memberPermissions, /assignedUid: explainForm\.assignedUid\.trim\(\) \|\| undefined/)
    assert.match(memberPermissions, /assignedUids: explainForm\.assignedUids\.trim\(\) \|\| undefined/)
    assert.match(memberPermissions, /matchedRelations: explainForm\.matchedRelations\.trim\(\) \|\| undefined/)
    assert.match(memberPermissions, /v-model="explainForm\.environment"/)
    assert.match(memberPermissions, /v-model="explainForm\.departmentTree"/)
    assert.match(memberPermissions, /v-model="explainForm\.projectMemberUids"/)
    assert.match(memberPermissions, /v-model="explainForm\.customerOwnerUid"/)
    assert.match(memberPermissions, /v-model="explainForm\.customerTeamUids"/)
    assert.match(memberPermissions, /v-model="explainForm\.assignedUid"/)
    assert.match(memberPermissions, /v-model="explainForm\.assignedUids"/)
    assert.match(memberPermissions, /v-model="explainForm\.matchedRelations"/)
  })
})
