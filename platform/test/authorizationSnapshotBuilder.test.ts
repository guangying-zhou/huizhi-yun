import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import type { RowDataPacket } from 'mysql2/promise'
import {
  buildAuthorizationSnapshotWithQueries,
  type AuthorizationQueryAdapter
} from '../server/utils/authorizationSnapshotBuilder.ts'

type AuthorizationSnapshotResult = Awaited<ReturnType<typeof buildAuthorizationSnapshotWithQueries>>

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
  relation_type: 'member'
}

const directRoles = [
  {
    subject_id: subject.id,
    role_id: 201,
    role_code: 'sales',
    role_name: '销售',
    role_type: 'custom',
    app_code: null,
    tenant_role_source: 'custom',
    source_role_code: null,
    source_type: 'manual',
    source_id: 'assignment-sales'
  },
  {
    subject_id: subject.id,
    role_id: 202,
    role_code: 'finance',
    role_name: '财务',
    role_type: 'custom',
    app_code: null,
    tenant_role_source: 'custom',
    source_role_code: null,
    source_type: 'manual',
    source_id: 'assignment-finance'
  },
  {
    subject_id: departmentSubject.id,
    role_id: 203,
    role_code: 'support_lead',
    role_name: '支持负责人',
    role_type: 'custom',
    app_code: null,
    tenant_role_source: 'custom',
    source_role_code: null,
    source_type: 'manual',
    source_id: 'assignment-support'
  }
]

const permissionRows = [
  {
    role_id: 201,
    app_code: 'crm',
    resource_code: 'customers',
    action: 'view'
  },
  {
    role_id: 202,
    app_code: 'finance',
    resource_code: 'payments',
    action: 'edit'
  },
  {
    role_id: 203,
    app_code: 'crm',
    resource_code: 'tickets',
    action: 'edit'
  }
]

const scopeRows = [
  {
    role_id: 201,
    app_code: 'crm',
    resource_code: 'customers',
    action: 'view',
    scope_type: 'department',
    scope_value: 'sales'
  },
  {
    role_id: 202,
    app_code: 'finance',
    resource_code: 'payments',
    action: 'edit',
    scope_type: 'department',
    scope_value: 'finance'
  }
]

function selectedRoleIds(params: unknown[]) {
  return new Set(params.filter((value): value is number => typeof value === 'number'))
}

function assertEffectiveSubjectRoleFilter(sql: string) {
  assert.match(sql, /tsr\.status = 'active'/)
  assert.match(sql, /\(tsr\.starts_at IS NULL OR tsr\.starts_at <= UTC_TIMESTAMP\(\)\)/)
  assert.match(sql, /\(tsr\.expired_at IS NULL OR tsr\.expired_at > UTC_TIMESTAMP\(\)\)/)
}

function createQueries(options: { includeInheritedMembership?: boolean } = {}): AuthorizationQueryAdapter {
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
      if (sql.includes('FROM tenant_subject_roles')) {
        assertEffectiveSubjectRoleFilter(sql)
        const subjectIds = selectedRoleIds(params)
        return directRoles.filter(row => subjectIds.has(row.subject_id)) as unknown as T
      }
      if (sql.includes('FROM tenant_template_bindings')) {
        return [] as unknown as T
      }
      if (sql.includes('FROM tenant_template_overrides')) {
        return [] as unknown as T
      }
      if (sql.includes('FROM tenant_role_permissions')) {
        const roleIds = selectedRoleIds(params)
        return permissionRows.filter(row => roleIds.has(row.role_id)) as unknown as T
      }
      if (sql.includes('FROM tenant_role_scopes')) {
        const roleIds = selectedRoleIds(params)
        return scopeRows.filter(row => roleIds.has(row.role_id)) as unknown as T
      }
      throw new Error(`Unexpected queryRows SQL: ${sql}`)
    }
  }
}

function roleCodes(snapshot: AuthorizationSnapshotResult) {
  return snapshot.roles.map(role => role.roleCode).sort()
}

function availableRoleCodes(snapshot: AuthorizationSnapshotResult) {
  return (snapshot.availableRoles || []).map(role => role.roleCode).sort()
}

function permissionKeys(snapshot: AuthorizationSnapshotResult) {
  return snapshot.permissions
    .map(permission => `${permission.appCode}:${permission.resourceCode}:${permission.action}`)
    .sort()
}

describe('buildAuthorizationSnapshotWithQueries 多角色 DB 快照', () => {
  test('普通运行默认合并多个有效企业角色', async () => {
    const snapshot = await buildAuthorizationSnapshotWithQueries(createQueries(), tenantCode, uid)

    assert.deepEqual(roleCodes(snapshot), ['finance', 'sales'])
    assert.deepEqual(availableRoleCodes(snapshot), ['finance', 'sales'])
    assert.deepEqual(permissionKeys(snapshot), [
      'crm:customers:view',
      'finance:payments:edit'
    ])
    assert.deepEqual(snapshot.scopes.map(scope => `${scope.appCode}:${scope.scopeValue}`).sort(), [
      'crm:sales',
      'finance:finance'
    ])
  })

  test('active 部门/职位 membership 上的主体角色会继承到用户授权快照', async () => {
    const snapshot = await buildAuthorizationSnapshotWithQueries(createQueries({ includeInheritedMembership: true }), tenantCode, uid)

    assert.deepEqual(roleCodes(snapshot), ['finance', 'sales', 'support_lead'])
    assert.deepEqual(permissionKeys(snapshot), [
      'crm:customers:view',
      'crm:tickets:edit',
      'finance:payments:edit'
    ])
    assert.equal(
      snapshot.availableRoles?.find(role => role.roleCode === 'support_lead')?.source.type,
      'membership:department'
    )
  })

  test('服务端允许 role_simulation 时只使用指定 active role', async () => {
    const snapshot = await buildAuthorizationSnapshotWithQueries(createQueries(), tenantCode, uid, null, {
      activeRoleCode: 'finance',
      authorizationMode: 'role_simulation',
      allowRoleSimulation: true
    })

    assert.deepEqual(roleCodes(snapshot), ['finance'])
    assert.equal(snapshot.activeRoleCode, 'finance')
    assert.deepEqual(permissionKeys(snapshot), ['finance:payments:edit'])
    assert.deepEqual(snapshot.scopes.map(scope => `${scope.appCode}:${scope.scopeValue}`), ['finance:finance'])
  })

  test('无效模拟角色不会回退到其他角色', async () => {
    const snapshot = await buildAuthorizationSnapshotWithQueries(createQueries(), tenantCode, uid, null, {
      activeRoleCode: 'hr',
      authorizationMode: 'role_simulation',
      allowRoleSimulation: true
    })

    assert.deepEqual(roleCodes(snapshot), [])
    assert.deepEqual(availableRoleCodes(snapshot), ['finance', 'sales'])
    assert.equal(snapshot.activeRoleCode, null)
    assert.deepEqual(snapshot.permissions, [])
    assert.deepEqual(snapshot.scopes, [])
  })

  test('未获服务端允许的角色模拟请求降级为 merged', async () => {
    const snapshot = await buildAuthorizationSnapshotWithQueries(createQueries(), tenantCode, uid, null, {
      activeRoleCode: 'finance',
      authorizationMode: 'role_simulation'
    })

    assert.deepEqual(roleCodes(snapshot), ['finance', 'sales'])
    assert.equal(snapshot.activeRoleCode, 'finance')
    assert.deepEqual(permissionKeys(snapshot), [
      'crm:customers:view',
      'finance:payments:edit'
    ])
  })
})
