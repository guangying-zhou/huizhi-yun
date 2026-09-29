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
  },
  {
    assignment_id: 1005,
    subject_id: subject.id,
    role_id: 205,
    role_code: 'prod_deployer',
    role_name: '生产部署',
    role_type: 'custom',
    app_code: null,
    source_type: 'manual',
    source_id: 'assignment-prod-deploy',
    assignment_kind: 'privileged',
    starts_at: null,
    expired_at: null
  },
  {
    assignment_id: 1006,
    subject_id: subject.id,
    role_id: 206,
    role_code: 'project_scoped_editor',
    role_name: '项目范围编辑',
    role_type: 'custom',
    app_code: null,
    source_type: 'manual',
    source_id: 'assignment-project-editor',
    assignment_kind: 'duty',
    starts_at: null,
    expired_at: null
  },
  {
    assignment_id: 1007,
    subject_id: subject.id,
    role_id: 207,
    role_code: 'customer_team_viewer',
    role_name: '客户团队查看',
    role_type: 'custom',
    app_code: null,
    source_type: 'manual',
    source_id: 'assignment-customer-team',
    assignment_kind: 'duty',
    starts_at: null,
    expired_at: null
  },
  {
    assignment_id: 1008,
    subject_id: subject.id,
    role_id: 208,
    role_code: 'assigned_task_viewer',
    role_name: '指派任务查看',
    role_type: 'custom',
    app_code: null,
    source_type: 'manual',
    source_id: 'assignment-assigned-task',
    assignment_kind: 'duty',
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
  },
  {
    role_id: 205,
    app_code: 'platform',
    resource_code: 'deployments',
    action: 'deploy'
  },
  {
    role_id: 206,
    app_code: 'aims',
    resource_code: 'projects',
    action: 'edit'
  },
  {
    role_id: 207,
    app_code: 'altoc',
    resource_code: 'customers',
    action: 'view'
  },
  {
    role_id: 208,
    app_code: 'workflow',
    resource_code: 'workflow_tasks',
    action: 'view'
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
  },
  {
    assignment_id: 1005,
    app_code: 'platform',
    resource_code: 'deployments',
    action: 'deploy',
    scope_dimension: 'environment',
    scope_predicate: 'prod',
    scope_value: null,
    scope_group: 'default',
    scope_mode: 'intersect'
  },
  {
    assignment_id: 1006,
    app_code: 'aims',
    resource_code: 'projects',
    action: 'edit',
    scope_dimension: 'project',
    scope_predicate: 'member',
    scope_value: 'PRJ-001',
    scope_group: 'default',
    scope_mode: 'intersect'
  },
  {
    assignment_id: 1007,
    app_code: 'altoc',
    resource_code: 'customers',
    action: 'view',
    scope_dimension: 'customer',
    scope_predicate: 'team',
    scope_value: null,
    scope_group: 'default',
    scope_mode: 'intersect'
  },
  {
    assignment_id: 1008,
    app_code: 'workflow',
    resource_code: 'workflow_tasks',
    action: 'view',
    scope_dimension: 'object',
    scope_predicate: 'assigned',
    scope_value: null,
    scope_group: 'default',
    scope_mode: 'intersect'
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

function missingTableError(tableName: string) {
  const error = new Error(`Table '${tableName}' doesn't exist`) as Error & { code?: string, errno?: number }
  error.code = 'ER_NO_SUCH_TABLE'
  error.errno = 1146
  return error
}

function createQueries(options: {
  includeInheritedMembership?: boolean
  omitDirectRoles?: boolean
  configuredBaselinePermissions?: RowDataPacket[]
  baselineExcludedSubjects?: string[]
  additionalDirectRoles?: typeof directRoles
  additionalPermissionRows?: typeof permissionRows
  additionalRoleScopeRows?: typeof roleScopeRows
} = {}): AuthorizationGrantQueryAdapter {
  const adapter = {
    queryRow: async (sql: string): Promise<RowDataPacket | null> => {
      if (sql.includes('FROM tenant_subjects')) {
        return subject as unknown as RowDataPacket
      }
      throw new Error(`Unexpected queryRow SQL: ${sql}`)
    },
    queryRows: async (sql: string, params: unknown[] = []): Promise<RowDataPacket[]> => {
      if (sql.includes('FROM tenant_subject_memberships')) {
        assert.match(sql, /tsm\.status = 'active'/)
        assert.match(sql, /tsm\.relation_type IN \('member', 'manager', 'leader'\)/)
        assert.match(sql, /container\.subject_type IN \('department', 'job'\)/)
        return (options.includeInheritedMembership ? [departmentSubject] : []) as unknown as RowDataPacket[]
      }
      if (sql.includes('FROM tenant_subject_roles tsr')) {
        assertEffectiveSubjectRoleFilter(sql)
        if (options.omitDirectRoles) return []
        const subjectIds = selectedNumbers(params)
        return [...directRoles, ...(options.additionalDirectRoles || [])].filter(row => subjectIds.has(row.subject_id)) as unknown as RowDataPacket[]
      }
      if (sql.includes('FROM tenant_template_bindings')) {
        return []
      }
      if (sql.includes('FROM tenant_template_overrides')) {
        return []
      }
      if (sql.includes('FROM tenant_role_permissions')) {
        const roleIds = selectedNumbers(params)
        return [...permissionRows, ...(options.additionalPermissionRows || [])].filter(row => roleIds.has(row.role_id)) as unknown as RowDataPacket[]
      }
      if (sql.includes('FROM tenant_role_scopes')) {
        const roleIds = selectedNumbers(params)
        return [...roleScopeRows, ...(options.additionalRoleScopeRows || [])].filter(row => roleIds.has(row.role_id)) as unknown as RowDataPacket[]
      }
      if (sql.includes('FROM tenant_subject_role_scopes')) {
        assert.match(sql, /status = 'active'/)
        assert.match(sql, /\(app_code IS NULL OR app_code = \?\)/)
        const assignmentIds = selectedNumbers(params)
        return assignmentScopeRows.filter(row => assignmentIds.has(row.assignment_id)) as unknown as RowDataPacket[]
      }
      if (sql.includes('FROM platform_baseline_permissions')) {
        if (!options.configuredBaselinePermissions) throw missingTableError('platform_baseline_permissions')
        const appCodeFilter = new Set(params.map(String))
        return options.configuredBaselinePermissions.filter(row =>
          appCodeFilter.size === 0 || appCodeFilter.has(String(row.app_code))
        ) as RowDataPacket[]
      }
      if (sql.includes('FROM platform_baseline_excluded_subjects')) {
        if (!options.configuredBaselinePermissions) throw missingTableError('platform_baseline_excluded_subjects')
        return (options.baselineExcludedSubjects || []).map(subjectCode => ({ subject_code: subjectCode })) as unknown as RowDataPacket[]
      }
      throw new Error(`Unexpected queryRows SQL: ${sql}`)
    }
  }
  return adapter as AuthorizationGrantQueryAdapter
}

describe('buildDbAuthorizationGrantsWithQueries', () => {
  test('product manager 旧 role scope 解析为 manager 而非 equals:manager', async () => {
    const base = {
      additionalDirectRoles: [{ ...directRoles[0]!, assignment_id: 9001, role_id: 9001,
        role_code: 'product_manager', role_name: '产品经理' }],
      additionalPermissionRows: [{ role_id: 9001, app_code: 'aims', resource_code: 'product_versions', action: 'accept' }],
      additionalRoleScopeRows: [{ role_id: 9001, app_code: 'aims', resource_code: 'product_versions',
        action: 'accept', scope_type: 'product', scope_value: 'manager' }]
    }
    const grantResult = await buildDbAuthorizationGrantsWithQueries(createQueries(base), tenantCode, uid, 'aims')
    const grant = grantResult.grants.find(row => row.roleCode === 'product_manager')
    assert.deepEqual(grant?.defaultScopes?.map(scope => `${scope.dimension}:${scope.predicate}:${scope.value}`), ['product:manager:null'])
    const oldMistake = await buildDbAuthorizationGrantsWithQueries(createQueries({ ...base,
      additionalRoleScopeRows: [{ ...base.additionalRoleScopeRows[0]!, scope_value: 'equals:manager' }]
    }), tenantCode, uid, 'aims')
    assert.equal(oldMistake.grants.find(row => row.roleCode === 'product_manager')?.defaultScopes?.[0]?.predicate, 'equals')
  })

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

  test('有效用户会叠加 baseline 授权单元，且不依赖企业角色', async () => {
    const grantResult = await buildDbAuthorizationGrantsWithQueries(createQueries({ omitDirectRoles: true }), tenantCode, uid, 'codocs')
    const baselineGrant = grantResult.grants.find(grant => grant.grantId === 'baseline:codocs:documents:create')

    assert.ok(baselineGrant)
    assert.equal(baselineGrant.roleCode, undefined)
    assert.equal(baselineGrant.subjectType, 'baseline')
    assert.equal(baselineGrant.sourceType, 'baseline')
    assert.deepEqual(baselineGrant.scopes.map(scope => `${scope.dimension}:${scope.predicate}:${scope.source}`), [
      'subject:self:baseline'
    ])
    assert.deepEqual(grantResult.roleIds, [])

    const allowed = await evaluateDbAuthorizationWithQueries(createQueries({ omitDirectRoles: true }), tenantCode, uid, 'codocs', {
      required: { appCode: 'codocs', resourceCode: 'documents', action: 'create' },
      object: { actorUid: uid, ownerUid: uid }
    })

    assert.equal(allowed.allowed, true)
    assert.equal(allowed.matchedGrantId, 'baseline:codocs:documents:create')

    const withoutBaseline = await evaluateDbAuthorizationWithQueries(createQueries({ omitDirectRoles: true }), tenantCode, uid, 'codocs', {
      includeBaseline: false,
      required: { appCode: 'codocs', resourceCode: 'documents', action: 'create' },
      object: { actorUid: uid, ownerUid: uid }
    })

    assert.equal(withoutBaseline.allowed, false)
    assert.equal(withoutBaseline.reasonCode, 'no_permission')
  })

  test('配置化 baseline 可排除指定用户', async () => {
    const configuredBaselinePermissions = [{
      id: 1,
      app_code: 'codocs',
      resource_code: 'documents',
      action: 'create',
      scope_type: 'subject',
      scope_value: 'self',
      description: null,
      sort_order: 1
    }] as unknown as RowDataPacket[]
    const queries = createQueries({
      omitDirectRoles: true,
      configuredBaselinePermissions,
      baselineExcludedSubjects: [uid]
    })

    const grantResult = await buildDbAuthorizationGrantsWithQueries(queries, tenantCode, uid, 'codocs')
    assert.equal(grantResult.grants.some(grant => grant.grantId === 'baseline:codocs:documents:create'), false)

    const denied = await evaluateDbAuthorizationWithQueries(queries, tenantCode, uid, 'codocs', {
      required: { appCode: 'codocs', resourceCode: 'documents', action: 'create' },
      object: { actorUid: uid, ownerUid: uid }
    })
    assert.equal(denied.allowed, false)
    assert.equal(denied.reasonCode, 'no_permission')
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

  test('权限解释会返回 baseline 来源和范围', async () => {
    const allowed = await explainDbAuthorizationWithQueries(createQueries(), tenantCode, uid, 'aims', {
      required: { appCode: 'aims', resourceCode: 'projects', action: 'view' },
      object: { matchedRelations: ['relation:participant'] }
    })

    assert.equal(allowed.allowed, true)
    assert.equal(allowed.matchedGrant?.grantId, 'baseline:aims:projects:view')
    assert.equal(allowed.matchedGrant?.roleCode, null)
    assert.equal(allowed.matchedGrant?.subjectType, 'baseline')
    assert.equal(allowed.matchedGrant?.sourceType, 'baseline')
    assert.deepEqual(allowed.matchedGrant?.relationScopes.map(scope => `${scope.dimension}:${scope.predicate}:${scope.source}`), [
      'relation:participant:baseline'
    ])

    const scopeDenied = await explainDbAuthorizationWithQueries(createQueries(), tenantCode, uid, 'aims', {
      required: { appCode: 'aims', resourceCode: 'projects', action: 'view' },
      object: {}
    })

    assert.equal(scopeDenied.allowed, false)
    assert.equal(scopeDenied.reasonCode, 'scope_not_matched')
    assert.equal(
      scopeDenied.candidateGrants.some(grant =>
        grant.grantId === 'baseline:aims:projects:view'
        && grant.sourceType === 'baseline'
        && !grant.scopeMatched
      ),
      true
    )
  })

  test('环境范围可解释生产部署权限', async () => {
    const allowed = await explainDbAuthorizationWithQueries(createQueries(), tenantCode, uid, 'platform', {
      required: { appCode: 'platform', resourceCode: 'deployments', action: 'deploy' },
      object: { environment: 'prod' }
    })

    assert.equal(allowed.allowed, true)
    assert.equal(allowed.matchedGrant?.grantId, 'subject-role:1005:platform:deployments:deploy')
    assert.deepEqual(allowed.matchedGrant?.assignmentScopes.map(scope => `${scope.dimension}:${scope.predicate}:${scope.value}`), [
      'environment:prod:null'
    ])

    const deploymentEnvironmentAllowed = await evaluateDbAuthorizationWithQueries(createQueries(), tenantCode, uid, 'platform', {
      required: { appCode: 'platform', resourceCode: 'deployments', action: 'deploy' },
      object: { deploymentEnvironment: 'prod' }
    })
    assert.equal(deploymentEnvironmentAllowed.allowed, true)

    const denied = await explainDbAuthorizationWithQueries(createQueries(), tenantCode, uid, 'platform', {
      required: { appCode: 'platform', resourceCode: 'deployments', action: 'deploy' },
      object: { environment: 'staging' }
    })

    assert.equal(denied.allowed, false)
    assert.equal(denied.reasonCode, 'scope_not_matched')
    assert.equal(denied.candidateGrants[0]?.scopeMatched, false)
  })

  test('项目编码型成员范围不能跨项目匹配', async () => {
    const allowed = await explainDbAuthorizationWithQueries(createQueries(), tenantCode, uid, 'aims', {
      required: { appCode: 'aims', resourceCode: 'projects', action: 'edit' },
      object: { actorUid: uid, projectCode: 'PRJ-001', projectMemberUids: [uid] }
    })

    assert.equal(allowed.allowed, true)
    assert.equal(allowed.matchedGrant?.grantId, 'subject-role:1006:aims:projects:edit')
    assert.deepEqual(allowed.matchedGrant?.assignmentScopes.map(scope => `${scope.dimension}:${scope.predicate}:${scope.value}`), [
      'project:member:PRJ-001'
    ])

    const denied = await explainDbAuthorizationWithQueries(createQueries(), tenantCode, uid, 'aims', {
      required: { appCode: 'aims', resourceCode: 'projects', action: 'edit' },
      object: { actorUid: uid, projectCode: 'PRJ-002', projectMemberUids: [uid] }
    })

    assert.equal(denied.allowed, false)
    assert.equal(denied.reasonCode, 'scope_not_matched')
    assert.equal(denied.candidateGrants.some(grant => grant.grantId === 'subject-role:1006:aims:projects:edit' && !grant.scopeMatched), true)
  })

  test('权限解释支持客户团队和对象指派范围', async () => {
    const customerAllowed = await explainDbAuthorizationWithQueries(createQueries(), tenantCode, uid, 'altoc', {
      required: { appCode: 'altoc', resourceCode: 'customers', action: 'view' },
      object: { actorUid: uid, customerTeamUids: [uid, 'user-2'] }
    })

    assert.equal(customerAllowed.allowed, true)
    assert.equal(customerAllowed.matchedGrant?.grantId, 'subject-role:1007:altoc:customers:view')
    assert.deepEqual(customerAllowed.matchedGrant?.assignmentScopes.map(scope => `${scope.dimension}:${scope.predicate}:${scope.value}`), [
      'customer:team:null'
    ])

    const customerDenied = await explainDbAuthorizationWithQueries(createQueries(), tenantCode, uid, 'altoc', {
      required: { appCode: 'altoc', resourceCode: 'customers', action: 'view' },
      object: { actorUid: uid, customerTeamUids: ['user-2'] }
    })

    assert.equal(customerDenied.allowed, false)
    assert.equal(customerDenied.reasonCode, 'scope_not_matched')

    const assignedAllowed = await explainDbAuthorizationWithQueries(createQueries(), tenantCode, uid, 'workflow', {
      required: { appCode: 'workflow', resourceCode: 'workflow_tasks', action: 'view' },
      object: { actorUid: uid, assignedUids: ['user-2', uid] }
    })

    assert.equal(assignedAllowed.allowed, true)
    assert.equal(assignedAllowed.matchedGrant?.grantId, 'subject-role:1008:workflow:workflow_tasks:view')
    assert.deepEqual(assignedAllowed.matchedGrant?.assignmentScopes.map(scope => `${scope.dimension}:${scope.predicate}:${scope.value}`), [
      'object:assigned:null'
    ])

    const assignedDenied = await explainDbAuthorizationWithQueries(createQueries(), tenantCode, uid, 'workflow', {
      required: { appCode: 'workflow', resourceCode: 'workflow_tasks', action: 'view' },
      object: { actorUid: uid, assignedUids: ['user-2'] }
    })

    assert.equal(assignedDenied.allowed, false)
    assert.equal(assignedDenied.reasonCode, 'scope_not_matched')
  })
})
