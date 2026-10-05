import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

function platformSource(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

function workspaceSource(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
}

function assertBefore(content: string, left: string, right: string) {
  const leftIndex = content.indexOf(left)
  const rightIndex = content.indexOf(right)
  assert.notEqual(leftIndex, -1, `Missing ${left}`)
  assert.notEqual(rightIndex, -1, `Missing ${right}`)
  assert.ok(leftIndex < rightIndex, `${left} must appear before ${right}`)
}

describe('project governance singleton enterprise roles', () => {
  test('schema and migration carry cardinality, subject type and revision facts', () => {
    const schema = workspaceSource('platform/docs/sql/HZY-Platform-SQL-DDL-Draft-v2.sql')
    const migration = workspaceSource('platform/docs/sql/HZY-Platform-SQL-Migration-v2.29-role-holder-cardinality.sql')

    for (const content of [schema, migration]) {
      assert.match(content, /platform_system_roles[\s\S]*max_active_assignments[\s\S]*subject_type_constraint/)
      assert.match(content, /tenant_roles[\s\S]*max_active_assignments[\s\S]*subject_type_constraint/)
      assert.match(content, /tenant_role_holder_revisions[\s\S]*revision/)
    }
    assert.match(migration, /role_code` IN \('project_director', 'qa'\)/)
  })

  test('generic assignment checks constraints under the role lock before writing', () => {
    const route = platformSource('server/api/platform/tenant-admin/subject-roles.post.ts')
    const constraints = platformSource('server/utils/roleAssignmentConstraints.ts')

    assertBefore(route, 'assertRoleAssignmentConstraints(tx', 'INSERT INTO tenant_subject_roles')
    assertBefore(constraints, 'FROM tenant_roles', 'FROM tenant_subject_roles')
    assert.match(constraints, /FOR UPDATE/)
    assert.match(constraints, /role_subject_type_mismatch/)
    assert.match(constraints, /role_assignment_capacity_exceeded/)
    assert.match(route, /bumpRoleHolderRevision/)
  })

  test('atomic replacement revokes old holders and creates one current user in one transaction', () => {
    const route = platformSource('server/api/platform/tenant-admin/role-holders/[roleCode].put.ts')

    assertBefore(route, 'requireTenantOwnerForTenantAdmin(event', 'readBody<Record<string, unknown>>(event)')
    assert.match(route, /max_active_assignments[\s\S]*subject_type_constraint/)
    assertBefore(route, 'UPDATE tenant_subject_roles', 'INSERT INTO tenant_subject_roles')
    assert.match(route, /status = 'revoked'/)
    assert.match(route, /source_id[\s\S]*'company-role-holder'/)
    assert.match(route, /expectedRevision/)
    assert.match(route, /bumpRoleHolderRevision/)
  })

  test('seed maps the singleton enterprise roles to precise Aims roles', () => {
    const seed = workspaceSource('platform/docs/sql/HZY-Platform-SQL-Seed-v2.19-project-governance-roles.sql')

    assert.match(seed, /SELECT 'project_director' AS `system_role_code`, 'aims:project_director' AS `app_role_code`/)
    assert.match(seed, /UNION ALL SELECT 'qa', 'aims:qa'/)
    assert.match(seed, /UNION ALL SELECT 'qa', 'codocs:viewer'/)
    assert.match(seed, /`max_active_assignments` = 1[\s\S]*`source_role_code` IN \('project_director', 'qa'\)/)
  })
})
