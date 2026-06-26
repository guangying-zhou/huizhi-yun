import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import type { RowDataPacket } from 'mysql2/promise'
import {
  buildDbAuthorizationGrantsWithQueries,
  evaluateDbAuthorizationWithQueries,
  explainDbAuthorizationWithQueries,
  type AuthorizationGrantQueryAdapter
} from '../server/utils/authorizationGrants.ts'

const tenantCode = 'tenant-demo'
const uid = 'user-1'

const subject = {
  id: 101,
  tenant_code: tenantCode,
  subject_type: 'user',
  subject_code: uid,
  display_name: '测试用户',
  external_ref: uid
}

const departmentSubject = {
  id: 301,
  tenant_code: tenantCode,
  subject_type: 'department',
  subject_code: 'dept-sales',
  relation_type: 'leader'
}

const directRoles = [
  {
    assignment_id: 1001,
    subject_id: subject.id,
    role_id: 201,
    role_code: 'crm_editor',
    role_name: '客户编辑',
    role_type: 'custom',
    app_code: null,
    source_type: 'manual',
    source_id: 'assignment-edit',
    assignment_kind: 'duty',
    starts_at: null,
    expired_at: null
  },
  {
    assignment_id: 1002,
    subject_id: subject.id,
    role_id: 202,
    role_code: 'crm_viewer',
    role_name: '客户查看',
    role_type: 'custom',
    app_code: null,
    source_type: 'manual',
    source_id: 'assignment-view',
    assignment_kind: 'duty',
    starts_at: null,
    expired_at: null
  },
  {
    assignment_id: 1003,
    subject_id: subject.id,
    role_id: 203,
    role_code: 'people_viewer',
    role_name: '人员查看',
    role_type: 'custom',
    app_code: null,
    source_type: 'manual',
    source_id: 'assignment-people',
    assignment_kind: 'duty',
    starts_at: null,
    expired_at: null
  },
  {
    assignment_id: 1004,
    subject_id: departmentSubject.id,
    role_id: 204,
    role_code: 'aims_department_lead',
    role_name: '研发部门负责人',
    role_type: 'custom',
    app_code: null,
    source_type: 'manual',
    source_id: 'assignment-aims-dept',
    assignment_kind: 'position',
    starts_at: null,
    expired_at: null
  }
]

const permissionRows = [
  {
    role_id: 201,
    app_code: 'crm',
    resource_code: 'customers',
    action: 'edit'
  },
  {
    role_id: 202,
    app_code: 'crm',
    resource_code: 'customers',
    action: 'view'
  },
  {
    role_id: 203,
    app_code: 'people',
    resource_code: 'employees',
    action: 'view'
  },
  {
    role_id: 204,
    app_code: 'aims',
    resource_code: 'projects',
    action: 'edit'
  }
]

const roleScopeRows = [
  {
    role_id: 203,
    app_code: 'people',
    resource_code: 'employees',
    action: 'view',
    scope_type: 'department',
    scope_value: 'dept-a'
  }
]

const assignmentScopeRows = [
  {
    assignment_id: 1001,
    app_code: 'crm',
    resource_code: 'customers',
    action: 'edit',
    scope_dimension: 'department',
    scope_predicate: 'self',
    scope_value: 'dept-a',
    scope_group: 'default',
    scope_mode: 'intersect'
  },
  {
    assignment_id: 1002,
    app_code: 'crm',
    resource_code: 'customers',
    action: 'view',
    scope_dimension: 'department',
    scope_predicate: 'self',
    scope_value: 'dept-b',
    scope_group: 'default',
    scope_mode: 'intersect'
  },
  {
    assignment_id: 1003,
    app_code: 'people',
    resource_code: 'employees',
    action: 'view',
    scope_dimension: 'department',
    scope_predicate: 'self',
    scope_value: 'dept-b',
    scope_group: 'default',
    scope_mode: 'replace'
  }
]

function selectedNumbers(params: unknown[]) {
  return new Set(params.filter((value): value is number => typeof value === 'number'))
}

function assertEffectiveSubjectRoleFilter(sql: string) {
  assert.match(sql, /tsr\.status = 'active'/)
  assert.match(sql, /\(tsr\.starts_at IS NULL OR tsr\.starts_at <= UTC_TIMESTAMP\(\)\)/)
  assert.match(sql, /\(tsr\.expired_at IS NULL OR tsr\.expired_at > UTC_TIMESTAMP\(\)\)/)
}

function createQueries(options: { includeInheritedMembership?: boolean } = {}): AuthorizationGrantQueryAdapter {
  return {
    queryRow: async <T extends RowDataPacket>(sql: string): Promise<T | null> => {
      if (sql.includes('FROM tenant_subjects')) {
        return subject as unknown as T
      }
      throw new Error(`Unexpected queryRow SQL: ${sql}`)
    },
    queryRows: async <T extends RowDataPacket[]>(sql: string, params: unknown[] = []): Promise<T> => {
      if (sql.includes('FROM tenant_subject_memberships')) {
        assert.match(sql, /tsm\.status = 'active'/)
        assert.match(sql, /tsm\.relation_type IN \('member', 'manager', 'leader'\)/)
        assert.match(sql, /container\.subject_type IN \('department', 'job'\)/)
        return (options.includeInheritedMembership ? [departmentSubject] : []) as unknown as T
      }
      if (sql.includes('FROM tenant_subject_roles tsr')) {
        assertEffectiveSubjectRoleFilter(sql)
        const subjectIds = selectedNumbers(params)
        return directRoles.filter(row => subjectIds.has(row.subject_id)) as unknown as T
      }
      if (sql.includes('FROM tenant_template_bindings')) {
        return [] as unknown as T
      }
      if (sql.includes('FROM tenant_template_overrides')) {
        return [] as unknown as T
      }
      if (sql.includes('FROM tenant_role_permissions')) {
        const roleIds = selectedNumbers(params)
        return permissionRows.filter(row => roleIds.has(row.role_id)) as unknown as T
      }
      if (sql.includes('FROM tenant_role_scopes')) {
        const roleIds = selectedNumbers(params)
        return roleScopeRows.filter(row => roleIds.has(row.role_id)) as unknown as T
      }
      if (sql.includes('FROM tenant_subject_role_scopes')) {
        assert.match(sql, /status = 'active'/)
        assert.match(sql, /\(app_code IS NULL OR app_code = \?\)/)
        const assignmentIds = selectedNumbers(params)
        return assignmentScopeRows.filter(row => assignmentIds.has(row.assignment_id)) as unknown as T
      }
      throw new Error(`Unexpected queryRows SQL: ${sql}`)
    }
  }
}

describe('buildDbAuthorizationGrantsWithQueries', () => {
  test('active 部门/职位 membership 上的主体角色会生成继承授权单元', async () => {
    const result = await evaluateDbAuthorizationWithQueries(
      createQueries({ includeInheritedMembership: true }),
      tenantCode,
      uid,
      'aims',
      {
        required: { appCode: 'aims', resourceCode: 'projects', action: 'edit' },
        object: { departmentCode: 'dept-sales' }
      }
    )

    assert.equal(result.allowed, true)
    assert.equal(result.matchedGrantId, 'subject-role:1004:aims:projects:edit')
    assert.equal(result.grants.find(grant => grant.roleCode === 'aims_department_lead')?.sourceType, 'membership:department')
    assert.equal(result.grants.find(grant => grant.roleCode === 'aims_department_lead')?.subjectType, 'department')
  })

  test('subjectRoleScopes 绑定到同一 assignment，不能跨授权拼接', async () => {
    const denied = await evaluateDbAuthorizationWithQueries(createQueries(), tenantCode, uid, 'crm', {
      required: { appCode: 'crm', resourceCode: 'customers', action: 'edit' },
      object: { departmentCode: 'dept-b' }
    })

    assert.equal(denied.allowed, false)
    assert.equal(denied.reasonCode, 'scope_not_matched')

    const allowed = await evaluateDbAuthorizationWithQueries(createQueries(), tenantCode, uid, 'crm', {
      required: { appCode: 'crm', resourceCode: 'customers', action: 'edit' },
      object: { departmentCode: 'dept-a' }
    })

    assert.equal(allowed.allowed, true)
    assert.equal(allowed.matchedGrantId, 'subject-role:1001:crm:customers:edit')
  })

  test('assignment scope replace 可替换角色默认范围', async () => {
    const grantResult = await buildDbAuthorizationGrantsWithQueries(createQueries(), tenantCode, uid, 'people')
    const peopleGrant = grantResult.grants.find(grant => grant.roleCode === 'people_viewer')
    assert.ok(peopleGrant)
    assert.deepEqual(peopleGrant.defaultScopes, [])
    assert.deepEqual(peopleGrant.assignmentScopes?.map(scope => `${scope.dimension}:${scope.predicate}:${scope.value}`), [
      'department:self:dept-b'
    ])

    const allowed = await evaluateDbAuthorizationWithQueries(createQueries(), tenantCode, uid, 'people', {
      required: { appCode: 'people', resourceCode: 'employees', action: 'view' },
      object: { departmentCode: 'dept-b' }
    })
    assert.equal(allowed.allowed, true)

    const denied = await evaluateDbAuthorizationWithQueries(createQueries(), tenantCode, uid, 'people', {
      required: { appCode: 'people', resourceCode: 'employees', action: 'view' },
      object: { departmentCode: 'dept-a' }
    })
    assert.equal(denied.allowed, false)
    assert.equal(denied.reasonCode, 'scope_not_matched')
  })

  test('权限解释返回命中授权单元和候选范围', async () => {
    const allowed = await explainDbAuthorizationWithQueries(createQueries(), tenantCode, uid, 'crm', {
      required: { appCode: 'crm', resourceCode: 'customers', action: 'edit' },
      object: { departmentCode: 'dept-a' }
    })

    assert.equal(allowed.allowed, true)
    assert.equal(allowed.matchedGrant?.grantId, 'subject-role:1001:crm:customers:edit')
    assert.equal(allowed.matchedGrant?.roleCode, 'crm_editor')
    assert.deepEqual(allowed.matchedGrant?.assignmentScopes.map(scope => `${scope.dimension}:${scope.predicate}:${scope.value}`), [
      'department:self:dept-a'
    ])

    const scopeDenied = await explainDbAuthorizationWithQueries(createQueries(), tenantCode, uid, 'crm', {
      required: { appCode: 'crm', resourceCode: 'customers', action: 'edit' },
      object: { departmentCode: 'dept-b' }
    })

    assert.equal(scopeDenied.allowed, false)
    assert.equal(scopeDenied.reasonCode, 'scope_not_matched')
    assert.equal(scopeDenied.matchedGrant, null)
    assert.equal(scopeDenied.candidateGrants.length, 1)
    assert.equal(scopeDenied.candidateGrants[0]?.scopeMatched, false)

    const noPermission = await explainDbAuthorizationWithQueries(createQueries(), tenantCode, uid, 'crm', {
      required: { appCode: 'crm', resourceCode: 'contracts', action: 'edit' }
    })

    assert.equal(noPermission.allowed, false)
    assert.equal(noPermission.reasonCode, 'no_permission')
    assert.deepEqual(noPermission.candidateGrants, [])
  })
})
