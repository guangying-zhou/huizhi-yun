import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildAllowedAppCodesFromPolicyBundle,
  evaluatePolicyBundleScopedAuthorization
} from '../server/utils/applicationAuthorization.ts'

function sorted(values: Iterable<string>) {
  return [...values].sort((left, right) => left.localeCompare(right))
}

function policyPayload() {
  return {
    subjects: [
      { subjectType: 'user', subjectCode: 'subject-u1', externalRef: 'u1', status: 'active' },
      { subjectType: 'user', subjectCode: 'subject-excluded', externalRef: 'u-excluded', status: 'active' }
    ],
    roles: [
      { roleCode: 'sales', roleName: '销售', appCode: null, status: 'active', isAssignable: 1 },
      { roleCode: 'finance', roleName: '财务', appCode: null, status: 'active', isAssignable: '1' },
      { roleCode: 'app-only', roleName: '应用角色', appCode: 'altoc', status: 'active', isAssignable: 1 },
      { roleCode: 'disabled-role', roleName: '停用角色', appCode: null, status: 'active', isAssignable: 0 }
    ],
    subjectRoles: [
      { subjectType: 'user', subjectCode: 'subject-u1', roleCode: 'sales', status: 'active' },
      { subjectType: 'user', subjectCode: 'subject-u1', roleCode: 'finance', status: 'active' },
      { subjectType: 'user', subjectCode: 'subject-u1', roleCode: 'app-only', status: 'active' },
      { subjectType: 'user', subjectCode: 'subject-u1', roleCode: 'disabled-role', status: 'active' }
    ],
    rolePermissions: [
      { roleCode: 'sales', appCode: 'altoc', resourceCode: 'customers', action: 'view' },
      { roleCode: 'finance', appCode: 'finance', resourceCode: 'payments', action: 'view' },
      { roleCode: 'app-only', appCode: 'people', resourceCode: 'profile', action: 'view' },
      { roleCode: 'disabled-role', appCode: 'assets', resourceCode: 'inventory', action: 'view' }
    ],
    baselinePermissions: [
      { appCode: 'workflow', resourceCode: 'tasks', action: 'view' },
      { appCode: 'console', resourceCode: 'workspace', action: 'view' }
    ]
  }
}

test('policy bundle 应用可见性：普通运行默认合并用户全部有效企业角色', () => {
  const result = buildAllowedAppCodesFromPolicyBundle({
    payload: policyPayload(),
    uid: 'u1',
    requestedRoleCode: 'finance'
  })

  assert.deepEqual(result.availableRoleCodes, ['finance', 'sales'])
  assert.deepEqual(result.selectedRoleCodes, ['finance', 'sales'])
  assert.equal(result.activeRoleCode, 'finance')
  assert.equal(result.hasActiveUserSubject, true)
  assert.deepEqual(sorted(result.allowedAppCodes), ['altoc', 'finance', 'workflow'])
})

test('policy bundle 应用可见性：只有显式角色模拟才按 active role 收窄', () => {
  const result = buildAllowedAppCodesFromPolicyBundle({
    payload: policyPayload(),
    uid: 'u1',
    requestedRoleCode: 'finance',
    authorizationMode: 'role_simulation',
    allowRoleSimulation: true
  })

  assert.deepEqual(result.availableRoleCodes, ['finance', 'sales'])
  assert.deepEqual(result.selectedRoleCodes, ['finance'])
  assert.equal(result.activeRoleCode, 'finance')
  assert.deepEqual(sorted(result.allowedAppCodes), ['finance', 'workflow'])
})

test('policy bundle 应用可见性：角色模拟可选择管理员本人未持有的有效企业角色', () => {
  const payload = policyPayload()
  ;(payload.roles as Array<Record<string, unknown>>).push({
    roleCode: 'hr',
    roleName: '人力资源',
    appCode: null,
    status: 'active',
    isAssignable: 1
  })
  ;(payload.rolePermissions as Array<Record<string, unknown>>).push({
    roleCode: 'hr',
    appCode: 'people',
    resourceCode: 'employees',
    action: 'view'
  })

  const result = buildAllowedAppCodesFromPolicyBundle({
    payload,
    uid: 'u1',
    requestedRoleCode: 'hr',
    authorizationMode: 'role_simulation',
    allowRoleSimulation: true
  })

  assert.equal(result.activeRoleCode, 'hr')
  assert.deepEqual(result.selectedRoleCodes, ['hr'])
  assert.deepEqual(sorted(result.allowedAppCodes), ['people', 'workflow'])
})

test('policy bundle 范围授权：角色模拟可为本人未持有的有效企业角色生成 grant', () => {
  const payload = {
    ...policyPayload(),
    roles: [
      ...policyPayload().roles,
      { roleCode: 'hr', roleName: '人力资源', appCode: null, status: 'active', isAssignable: 1 }
    ],
    rolePermissions: [
      ...policyPayload().rolePermissions,
      { roleCode: 'hr', appCode: 'people', resourceCode: 'employees', action: 'view' }
    ],
    roleScopes: [
      { roleCode: 'hr', appCode: 'people', resourceCode: 'employees', action: 'view', scopeType: 'department', scopeValue: 'dept-hr', status: 'active' }
    ]
  }

  const result = evaluatePolicyBundleScopedAuthorization({
    payload,
    uid: 'u1',
    requestedRoleCode: 'hr',
    authorizationMode: 'role_simulation',
    allowRoleSimulation: true,
    required: { appCode: 'people', resourceCode: 'employees', action: 'view' },
    object: { departmentCode: 'dept-hr' }
  })

  assert.equal(result.allowed, true)
  assert.deepEqual(result.selectedRoleCodes, ['hr'])
  assert.match(result.matchedGrantId || '', /^simulation:hr:/)
  assert.equal(result.matchedScopes?.some(scope => scope.source === 'role_default' && scope.value === 'dept-hr'), true)
})

test('policy bundle 范围授权：模拟本人已持有角色时保留 assignment scope', () => {
  const payload = {
    subjects: [
      { subjectType: 'user', subjectCode: 'subject-u1', externalRef: 'u1', status: 'active' }
    ],
    roles: [
      { roleCode: 'hr', roleName: '人力资源', appCode: null, status: 'active', isAssignable: 1 }
    ],
    subjectRoles: [
      { assignmentId: 1010, subjectType: 'user', subjectCode: 'subject-u1', roleCode: 'hr', status: 'active' }
    ],
    rolePermissions: [
      { roleCode: 'hr', appCode: 'people', resourceCode: 'employees', action: 'view' }
    ],
    roleScopes: [
      { roleCode: 'hr', appCode: 'people', resourceCode: 'employees', action: 'view', scopeType: 'department', scopeValue: 'dept-root', status: 'active' }
    ],
    subjectRoleScopes: [
      { assignmentId: 1010, appCode: 'people', resourceCode: 'employees', action: 'view', scopeDimension: 'department', scopePredicate: 'self', scopeValue: 'dept-hr', scopeMode: 'replace', status: 'active' }
    ]
  }

  const simulated = evaluatePolicyBundleScopedAuthorization({
    payload,
    uid: 'u1',
    requestedRoleCode: 'hr',
    authorizationMode: 'role_simulation',
    allowRoleSimulation: true,
    required: { appCode: 'people', resourceCode: 'employees', action: 'view' },
    object: { departmentCode: 'dept-hr' }
  })

  assert.equal(simulated.allowed, true)
  assert.match(simulated.matchedGrantId || '', /^assignment:1010:/)
  assert.equal(simulated.grants.some(grant => grant.grantId.startsWith('simulation:')), false)

  const outsideAssignment = evaluatePolicyBundleScopedAuthorization({
    payload,
    uid: 'u1',
    requestedRoleCode: 'hr',
    authorizationMode: 'role_simulation',
    allowRoleSimulation: true,
    required: { appCode: 'people', resourceCode: 'employees', action: 'view' },
    object: { departmentCode: 'dept-root' }
  })

  assert.equal(outsideAssignment.allowed, false)
  assert.equal(outsideAssignment.reasonCode, 'scope_not_matched')
})

test('policy bundle 范围授权：角色模拟请求无效角色时保持 fail closed', () => {
  const result = evaluatePolicyBundleScopedAuthorization({
    payload: policyPayload(),
    uid: 'u1',
    requestedRoleCode: 'hr',
    authorizationMode: 'role_simulation',
    allowRoleSimulation: true,
    required: { appCode: 'people', resourceCode: 'employees', action: 'view' },
    object: {}
  })

  assert.equal(result.allowed, false)
  assert.deepEqual(result.selectedRoleCodes, [])
  assert.equal(result.reasonCode, 'no_permission')
})

test('policy bundle 应用可见性：角色模拟关闭 baseline 时不显示基础应用', () => {
  const result = buildAllowedAppCodesFromPolicyBundle({
    payload: policyPayload(),
    uid: 'u1',
    requestedRoleCode: 'finance',
    authorizationMode: 'role_simulation',
    allowRoleSimulation: true,
    includeBaseline: false
  })

  assert.deepEqual(sorted(result.allowedAppCodes), ['finance'])
})

test('policy bundle 应用可见性：角色模拟请求无效角色时不得回退到其他角色', () => {
  const result = buildAllowedAppCodesFromPolicyBundle({
    payload: policyPayload(),
    uid: 'u1',
    requestedRoleCode: 'hr',
    authorizationMode: 'role_simulation',
    allowRoleSimulation: true
  })

  assert.deepEqual(result.availableRoleCodes, ['finance', 'sales'])
  assert.deepEqual(result.selectedRoleCodes, [])
  assert.equal(result.activeRoleCode, '')
  assert.deepEqual(sorted(result.allowedAppCodes), ['workflow'])
})

test('policy bundle 应用可见性：未授权的角色模拟请求按 merged 处理', () => {
  const result = buildAllowedAppCodesFromPolicyBundle({
    payload: policyPayload(),
    uid: 'u1',
    requestedRoleCode: 'finance',
    authorizationMode: 'role_simulation'
  })

  assert.deepEqual(result.selectedRoleCodes, ['finance', 'sales'])
  assert.equal(result.activeRoleCode, 'finance')
  assert.deepEqual(sorted(result.allowedAppCodes), ['altoc', 'finance', 'workflow'])
})

test('policy bundle 应用可见性：active 部门/职位 membership 上的主体角色会继承', () => {
  const payload = {
    subjects: [
      { subjectType: 'user', subjectCode: 'subject-u1', externalRef: 'u1', status: 'active' },
      { subjectType: 'department', subjectCode: 'dept-sales', status: 'active' },
      { subjectType: 'job', subjectCode: 'job-finance-lead', status: 'active' }
    ],
    subjectMemberships: [
      { subjectType: 'user', subjectCode: 'subject-u1', containerSubjectType: 'department', containerSubjectCode: 'dept-sales', relationType: 'member', status: 'active' },
      { subjectType: 'user', subjectCode: 'subject-u1', containerSubjectType: 'job', containerSubjectCode: 'job-finance-lead', relationType: 'leader', status: 'active' }
    ],
    roles: [
      { roleCode: 'dept-aims-editor', roleName: '部门研发编辑', appCode: null, status: 'active', isAssignable: 1 },
      { roleCode: 'job-finance-viewer', roleName: '岗位财务查看', appCode: null, status: 'active', isAssignable: 1 }
    ],
    subjectRoles: [
      { assignmentId: 3001, subjectType: 'department', subjectCode: 'dept-sales', roleCode: 'dept-aims-editor', status: 'active' },
      { assignmentId: 3002, subjectType: 'job', subjectCode: 'job-finance-lead', roleCode: 'job-finance-viewer', status: 'active' }
    ],
    rolePermissions: [
      { roleCode: 'dept-aims-editor', appCode: 'aims', resourceCode: 'projects', action: 'edit' },
      { roleCode: 'job-finance-viewer', appCode: 'finance', resourceCode: 'payments', action: 'view' }
    ]
  }

  const result = buildAllowedAppCodesFromPolicyBundle({
    payload,
    uid: 'u1'
  })

  assert.deepEqual(result.availableRoleCodes, ['dept-aims-editor', 'job-finance-viewer'])
  assert.deepEqual(sorted(result.allowedAppCodes), ['aims', 'finance'])
})

test('policy bundle 范围授权：subjectRoleScopes 绑定到同一 assignment，不能跨授权拼接', () => {
  const payload = {
    subjects: [
      { subjectType: 'user', subjectCode: 'subject-u1', externalRef: 'u1', status: 'active' },
      { subjectType: 'user', subjectCode: 'subject-excluded', externalRef: 'u-excluded', status: 'active' }
    ],
    roles: [
      { roleCode: 'project-editor', roleName: '项目编辑', appCode: null, status: 'active', isAssignable: 1 },
      { roleCode: 'project-viewer', roleName: '项目查看', appCode: null, status: 'active', isAssignable: 1 }
    ],
    subjectRoles: [
      { assignmentId: 1001, subjectType: 'user', subjectCode: 'subject-u1', roleCode: 'project-editor', status: 'active' },
      { assignmentId: 1002, subjectType: 'user', subjectCode: 'subject-u1', roleCode: 'project-viewer', status: 'active' }
    ],
    rolePermissions: [
      { roleCode: 'project-editor', appCode: 'aims', resourceCode: 'projects', action: 'edit' },
      { roleCode: 'project-viewer', appCode: 'aims', resourceCode: 'projects', action: 'view' }
    ],
    subjectRoleScopes: [
      { assignmentId: 1001, appCode: 'aims', resourceCode: 'projects', action: 'edit', scopeDimension: 'project', scopePredicate: 'member', scopeValue: 'project-a', status: 'active' },
      { assignmentId: 1002, appCode: 'aims', resourceCode: 'projects', action: 'view', scopeDimension: 'project', scopePredicate: 'member', scopeValue: 'project-b', status: 'active' }
    ]
  }

  const denied = evaluatePolicyBundleScopedAuthorization({
    payload,
    uid: 'u1',
    required: { appCode: 'aims', resourceCode: 'projects', action: 'edit' },
    object: {
      actorUid: 'u1',
      projectCode: 'project-b',
      projectMemberUids: ['u1']
    }
  })

  assert.equal(denied.allowed, false)
  assert.equal(denied.reasonCode, 'scope_not_matched')

  const allowed = evaluatePolicyBundleScopedAuthorization({
    payload,
    uid: 'u1',
    required: { appCode: 'aims', resourceCode: 'projects', action: 'edit' },
    object: {
      actorUid: 'u1',
      projectCode: 'project-a',
      projectMemberUids: ['u1']
    }
  })

  assert.equal(allowed.allowed, true)
  assert.match(allowed.matchedGrantId || '', /^assignment:1001:/)
})

test('policy bundle 范围授权：active 部门/职位 membership 上的主体授权可生成 grant', () => {
  const payload = {
    subjects: [
      { subjectType: 'user', subjectCode: 'subject-u1', externalRef: 'u1', status: 'active' },
      { subjectType: 'department', subjectCode: 'dept-sales', status: 'active' }
    ],
    subjectMemberships: [
      { subjectType: 'user', subjectCode: 'subject-u1', containerSubjectType: 'department', containerSubjectCode: 'dept-sales', relationType: 'manager', status: 'active' }
    ],
    roles: [
      { roleCode: 'dept-people-viewer', roleName: '部门人员查看', appCode: null, status: 'active', isAssignable: 1 }
    ],
    subjectRoles: [
      { assignmentId: 4001, subjectType: 'department', subjectCode: 'dept-sales', roleCode: 'dept-people-viewer', status: 'active' }
    ],
    rolePermissions: [
      { roleCode: 'dept-people-viewer', appCode: 'people', resourceCode: 'employees', action: 'view' }
    ],
    subjectRoleScopes: [
      { assignmentId: 4001, appCode: 'people', resourceCode: 'employees', action: 'view', scopeDimension: 'department', scopePredicate: 'self', scopeValue: 'dept-sales', status: 'active' }
    ]
  }

  const allowed = evaluatePolicyBundleScopedAuthorization({
    payload,
    uid: 'u1',
    required: { appCode: 'people', resourceCode: 'employees', action: 'view' },
    object: { departmentCode: 'dept-sales' }
  })

  assert.equal(allowed.allowed, true)
  assert.match(allowed.matchedGrantId || '', /^assignment:4001:/)
})

test('policy bundle 范围授权：assignment scope replace 可替换角色默认范围', () => {
  const payload = {
    subjects: [
      { subjectType: 'user', subjectCode: 'subject-u1', externalRef: 'u1', status: 'active' }
    ],
    roles: [
      { roleCode: 'dept-viewer', roleName: '部门查看', appCode: null, status: 'active', isAssignable: 1 }
    ],
    subjectRoles: [
      { assignmentId: 2001, subjectType: 'user', subjectCode: 'subject-u1', roleCode: 'dept-viewer', status: 'active' }
    ],
    rolePermissions: [
      { roleCode: 'dept-viewer', appCode: 'people', resourceCode: 'employees', action: 'view' }
    ],
    roleScopes: [
      { roleCode: 'dept-viewer', appCode: 'people', resourceCode: 'employees', action: 'view', scopeType: 'department', scopeValue: 'dept-a', status: 'active' }
    ],
    subjectRoleScopes: [
      { assignmentId: 2001, appCode: 'people', resourceCode: 'employees', action: 'view', scopeDimension: 'department', scopePredicate: 'self', scopeValue: 'dept-b', scopeMode: 'replace', status: 'active' }
    ]
  }

  const allowed = evaluatePolicyBundleScopedAuthorization({
    payload,
    uid: 'u1',
    required: { appCode: 'people', resourceCode: 'employees', action: 'view' },
    object: { departmentCode: 'dept-b' }
  })

  assert.equal(allowed.allowed, true)
  assert.equal(allowed.matchedScopes?.some(scope => scope.value === 'dept-b'), true)
  assert.equal(allowed.matchedScopes?.some(scope => scope.value === 'dept-a'), false)

  const denied = evaluatePolicyBundleScopedAuthorization({
    payload,
    uid: 'u1',
    required: { appCode: 'people', resourceCode: 'employees', action: 'view' },
    object: { departmentCode: 'dept-a' }
  })

  assert.equal(denied.allowed, false)
  assert.equal(denied.reasonCode, 'scope_not_matched')
})

test('policy bundle v2 兼容字段：应用可见性优先读取 roleAssignments 和 baselineGrants', () => {
  const payload = {
    compatSchemaVersions: ['policy-bundle.v2'],
    subjects: [
      { subjectType: 'user', subjectCode: 'subject-u1', externalRef: 'u1', status: 'active' }
    ],
    roles: [
      { roleCode: 'sales', roleName: '销售', appCode: null, status: 'active', isAssignable: 1 }
    ],
    roleAssignments: [
      { assignmentId: 5001, subjectType: 'user', subjectCode: 'subject-u1', roleCode: 'sales', status: 'active' }
    ],
    rolePermissions: [
      { roleCode: 'sales', appCode: 'altoc', resourceCode: 'customers', action: 'view' }
    ],
    baselineGrants: [
      { grantId: 'baseline:workflow:workflow_tasks:view:relation:assigned', appCode: 'workflow', resourceCode: 'workflow_tasks', action: 'view', scopeDimension: 'relation', scopePredicate: 'assigned', scopeValue: null, sourceType: 'baseline', status: 'active' },
      { grantId: 'baseline:console:workspace:view:tenant:global', appCode: 'console', resourceCode: 'workspace', action: 'view', scopeDimension: 'tenant', scopePredicate: 'global', scopeValue: null, sourceType: 'baseline', status: 'active' },
      { grantId: 'baseline:codocs:documents:view:relation:owned_or_shared', appCode: 'codocs', resourceCode: 'documents', action: 'view', scopeDimension: 'relation', scopePredicate: 'owned_or_shared', scopeValue: null, sourceType: 'baseline', status: 'active', excludedSubjectCodes: ['u1'] }
    ]
  }

  const result = buildAllowedAppCodesFromPolicyBundle({
    payload,
    uid: 'u1'
  })

  assert.deepEqual(result.availableRoleCodes, ['sales'])
  assert.deepEqual(result.selectedRoleCodes, ['sales'])
  assert.deepEqual(sorted(result.allowedAppCodes), ['altoc', 'workflow'])
})

test('policy bundle v2 兼容字段：应用可见性可只读取 rolePermissionGrants', () => {
  const payload = {
    compatSchemaVersions: ['policy-bundle.v2'],
    subjects: [
      { subjectType: 'user', subjectCode: 'subject-u1', externalRef: 'u1', status: 'active' }
    ],
    roles: [
      { roleCode: 'sales', roleName: '销售', appCode: null, status: 'active', isAssignable: 1 }
    ],
    roleAssignments: [
      { assignmentId: 5101, subjectType: 'user', subjectCode: 'subject-u1', roleCode: 'sales', status: 'active' }
    ],
    rolePermissionGrants: [
      { grantId: 'role-permission:sales:altoc:customers:view:custom::1', roleCode: 'sales', appCode: 'altoc', resourceCode: 'customers', action: 'view', status: 'active' }
    ],
    baselineGrants: [
      { grantId: 'baseline:workflow:workflow_tasks:view:relation:assigned', appCode: 'workflow', resourceCode: 'workflow_tasks', action: 'view', scopeDimension: 'relation', scopePredicate: 'assigned', scopeValue: null, sourceType: 'baseline', status: 'active' }
    ]
  }

  const result = buildAllowedAppCodesFromPolicyBundle({
    payload,
    uid: 'u1'
  })

  assert.deepEqual(result.availableRoleCodes, ['sales'])
  assert.deepEqual(result.selectedRoleCodes, ['sales'])
  assert.deepEqual(sorted(result.allowedAppCodes), ['altoc', 'workflow'])
})

test('policy bundle v2 兼容字段：rolePermissionGrants 存在时不混入历史 rolePermissions', () => {
  const payload = {
    compatSchemaVersions: ['policy-bundle.v2'],
    subjects: [
      { subjectType: 'user', subjectCode: 'subject-u1', externalRef: 'u1', status: 'active' }
    ],
    roles: [
      { roleCode: 'sales', roleName: '销售', appCode: null, status: 'active', isAssignable: 1 }
    ],
    roleAssignments: [
      { assignmentId: 5105, subjectType: 'user', subjectCode: 'subject-u1', roleCode: 'sales', status: 'active' }
    ],
    rolePermissionGrants: [
      { grantId: 'role-permission:sales:altoc:customers:view:custom::1', roleCode: 'sales', appCode: 'altoc', resourceCode: 'customers', action: 'view', status: 'active' }
    ],
    rolePermissions: [
      { roleCode: 'sales', appCode: 'finance', resourceCode: 'reports', action: 'export' }
    ],
    baselineGrants: []
  }

  const apps = buildAllowedAppCodesFromPolicyBundle({
    payload,
    uid: 'u1'
  })
  assert.deepEqual(sorted(apps.allowedAppCodes), ['altoc'])

  const stalePermission = evaluatePolicyBundleScopedAuthorization({
    payload,
    uid: 'u1',
    required: { appCode: 'finance', resourceCode: 'reports', action: 'export' },
    object: {}
  })

  assert.equal(stalePermission.allowed, false)
  assert.equal(stalePermission.reasonCode, 'no_permission')
})

test('policy bundle v2 兼容字段：roleAssignments 存在时不混入历史 subjectRoles', () => {
  const payload = {
    compatSchemaVersions: ['policy-bundle.v2'],
    subjects: [
      { subjectType: 'user', subjectCode: 'subject-u1', externalRef: 'u1', status: 'active' }
    ],
    roles: [
      { roleCode: 'sales', roleName: '销售', appCode: null, status: 'active', isAssignable: 1 },
      { roleCode: 'finance', roleName: '财务', appCode: null, status: 'active', isAssignable: 1 }
    ],
    roleAssignments: [
      { assignmentId: 5106, subjectType: 'user', subjectCode: 'subject-u1', roleCode: 'sales', status: 'active' }
    ],
    subjectRoles: [
      { assignmentId: 4106, subjectType: 'user', subjectCode: 'subject-u1', roleCode: 'finance', status: 'active' }
    ],
    rolePermissionGrants: [
      { grantId: 'role-permission:sales:altoc:customers:view:custom::1', roleCode: 'sales', appCode: 'altoc', resourceCode: 'customers', action: 'view', status: 'active' },
      { grantId: 'role-permission:finance:finance:reports:export:custom::1', roleCode: 'finance', appCode: 'finance', resourceCode: 'reports', action: 'export', status: 'active' }
    ],
    baselineGrants: []
  }

  const apps = buildAllowedAppCodesFromPolicyBundle({
    payload,
    uid: 'u1'
  })

  assert.deepEqual(apps.availableRoleCodes, ['sales'])
  assert.deepEqual(apps.selectedRoleCodes, ['sales'])
  assert.deepEqual(sorted(apps.allowedAppCodes), ['altoc'])

  const staleRolePermission = evaluatePolicyBundleScopedAuthorization({
    payload,
    uid: 'u1',
    required: { appCode: 'finance', resourceCode: 'reports', action: 'export' },
    object: {}
  })

  assert.equal(staleRolePermission.allowed, false)
  assert.equal(staleRolePermission.reasonCode, 'no_permission')
})

test('policy bundle v2 兼容字段：assignmentScopes 存在时不混入历史 subjectRoleScopes', () => {
  const payload = {
    compatSchemaVersions: ['policy-bundle.v2'],
    subjects: [
      { subjectType: 'user', subjectCode: 'subject-u1', externalRef: 'u1', status: 'active' }
    ],
    roles: [
      { roleCode: 'people-viewer', roleName: '人员查看', appCode: null, status: 'active', isAssignable: 1 }
    ],
    roleAssignments: [
      { assignmentId: 5107, subjectType: 'user', subjectCode: 'subject-u1', roleCode: 'people-viewer', status: 'active' }
    ],
    rolePermissionGrants: [
      { grantId: 'role-permission:people-viewer:people:employees:view:custom::1', roleCode: 'people-viewer', appCode: 'people', resourceCode: 'employees', action: 'view', status: 'active' }
    ],
    assignmentScopes: [
      { assignmentId: 5107, appCode: 'people', resourceCode: 'employees', action: 'view', scopeDimension: 'department', scopePredicate: 'self', scopeValue: 'dept-current', scopeMode: 'replace', status: 'active' }
    ],
    subjectRoleScopes: [
      { assignmentId: 5107, appCode: 'people', resourceCode: 'employees', action: 'view', scopeDimension: 'department', scopePredicate: 'self', scopeValue: 'dept-stale', scopeMode: 'replace', status: 'active' }
    ]
  }

  const allowed = evaluatePolicyBundleScopedAuthorization({
    payload,
    uid: 'u1',
    required: { appCode: 'people', resourceCode: 'employees', action: 'view' },
    object: { departmentCode: 'dept-current' }
  })

  assert.equal(allowed.allowed, true)
  assert.match(allowed.matchedGrantId || '', /^assignment:5107:/)
  assert.equal(allowed.matchedScopes?.some(scope => scope.value === 'dept-current'), true)
  assert.equal(allowed.matchedScopes?.some(scope => scope.value === 'dept-stale'), false)

  const staleScope = evaluatePolicyBundleScopedAuthorization({
    payload,
    uid: 'u1',
    required: { appCode: 'people', resourceCode: 'employees', action: 'view' },
    object: { departmentCode: 'dept-stale' }
  })

  assert.equal(staleScope.allowed, false)
  assert.equal(staleScope.reasonCode, 'scope_not_matched')
})

test('policy bundle v2 兼容字段：roleDefaultScopes 存在时不混入历史 roleScopes', () => {
  const payload = {
    compatSchemaVersions: ['policy-bundle.v2'],
    subjects: [
      { subjectType: 'user', subjectCode: 'subject-u1', externalRef: 'u1', status: 'active' }
    ],
    roles: [
      { roleCode: 'people-viewer', roleName: '人员查看', appCode: null, status: 'active', isAssignable: 1 }
    ],
    roleAssignments: [
      { assignmentId: 5108, subjectType: 'user', subjectCode: 'subject-u1', roleCode: 'people-viewer', status: 'active' }
    ],
    rolePermissionGrants: [
      { grantId: 'role-permission:people-viewer:people:employees:view:custom::1', roleCode: 'people-viewer', appCode: 'people', resourceCode: 'employees', action: 'view', status: 'active' }
    ],
    roleDefaultScopes: [
      { roleCode: 'people-viewer', appCode: 'people', resourceCode: 'employees', action: 'view', scopeDimension: 'department', scopePredicate: 'tree', scopeValue: 'dept-current', status: 'active' }
    ],
    roleScopes: [
      { roleCode: 'people-viewer', appCode: 'people', resourceCode: 'employees', action: 'view', scopeDimension: 'department', scopePredicate: 'tree', scopeValue: 'dept-stale', status: 'active' }
    ]
  }

  const allowed = evaluatePolicyBundleScopedAuthorization({
    payload,
    uid: 'u1',
    required: { appCode: 'people', resourceCode: 'employees', action: 'view' },
    object: { departmentCode: 'dept-sales', departmentTree: ['dept-current', 'dept-sales'] }
  })

  assert.equal(allowed.allowed, true)
  assert.match(allowed.matchedGrantId || '', /^assignment:5108:/)
  assert.equal(allowed.matchedScopes?.some(scope => scope.source === 'role_default' && scope.value === 'dept-current'), true)
  assert.equal(allowed.matchedScopes?.some(scope => scope.value === 'dept-stale'), false)

  const staleDefaultScope = evaluatePolicyBundleScopedAuthorization({
    payload,
    uid: 'u1',
    required: { appCode: 'people', resourceCode: 'employees', action: 'view' },
    object: { departmentCode: 'dept-finance', departmentTree: ['dept-stale', 'dept-finance'] }
  })

  assert.equal(staleDefaultScope.allowed, false)
  assert.equal(staleDefaultScope.reasonCode, 'scope_not_matched')
})

test('policy bundle v2 兼容字段：范围授权优先读取 assignmentScopes 和 roleDefaultScopes', () => {
  const payload = {
    compatSchemaVersions: ['policy-bundle.v2'],
    subjects: [
      { subjectType: 'user', subjectCode: 'subject-u1', externalRef: 'u1', status: 'active' }
    ],
    roles: [
      { roleCode: 'people-viewer', roleName: '人员查看', appCode: null, status: 'active', isAssignable: 1 }
    ],
    roleAssignments: [
      { assignmentId: 5002, subjectType: 'user', subjectCode: 'subject-u1', roleCode: 'people-viewer', status: 'active' }
    ],
    rolePermissions: [
      { roleCode: 'people-viewer', appCode: 'people', resourceCode: 'employees', action: 'view' }
    ],
    roleDefaultScopes: [
      { roleCode: 'people-viewer', appCode: 'people', resourceCode: 'employees', action: 'view', scopeType: 'department', scopeValue: 'dept-a', status: 'active' }
    ],
    assignmentScopes: [
      { assignmentId: 5002, appCode: 'people', resourceCode: 'employees', action: 'view', scopeDimension: 'department', scopePredicate: 'self', scopeValue: 'dept-b', scopeMode: 'replace', status: 'active' }
    ]
  }

  const allowed = evaluatePolicyBundleScopedAuthorization({
    payload,
    uid: 'u1',
    required: { appCode: 'people', resourceCode: 'employees', action: 'view' },
    object: { departmentCode: 'dept-b' }
  })

  assert.equal(allowed.allowed, true)
  assert.match(allowed.matchedGrantId || '', /^assignment:5002:/)
  assert.equal(allowed.matchedScopes?.some(scope => scope.value === 'dept-b'), true)
  assert.equal(allowed.matchedScopes?.some(scope => scope.value === 'dept-a'), false)

  const denied = evaluatePolicyBundleScopedAuthorization({
    payload,
    uid: 'u1',
    required: { appCode: 'people', resourceCode: 'employees', action: 'view' },
    object: { departmentCode: 'dept-a' }
  })

  assert.equal(denied.allowed, false)
  assert.equal(denied.reasonCode, 'scope_not_matched')
})

test('policy bundle v2 兼容字段：范围授权可只读取 rolePermissionGrants', () => {
  const payload = {
    compatSchemaVersions: ['policy-bundle.v2'],
    subjects: [
      { subjectType: 'user', subjectCode: 'subject-u1', externalRef: 'u1', status: 'active' }
    ],
    roles: [
      { roleCode: 'people-viewer', roleName: '人员查看', appCode: null, status: 'active', isAssignable: 1 }
    ],
    roleAssignments: [
      { assignmentId: 5102, subjectType: 'user', subjectCode: 'subject-u1', roleCode: 'people-viewer', status: 'active' }
    ],
    rolePermissionGrants: [
      { grantId: 'role-permission:people-viewer:people:employees:view:custom::1', roleCode: 'people-viewer', appCode: 'people', resourceCode: 'employees', action: 'view', status: 'active' }
    ],
    roleDefaultScopes: [
      { roleCode: 'people-viewer', appCode: 'people', resourceCode: 'employees', action: 'view', scopeType: 'department', scopeValue: 'dept-a', status: 'active' }
    ],
    assignmentScopes: [
      { assignmentId: 5102, appCode: 'people', resourceCode: 'employees', action: 'view', scopeDimension: 'department', scopePredicate: 'self', scopeValue: 'dept-b', scopeMode: 'replace', status: 'active' }
    ]
  }

  const allowed = evaluatePolicyBundleScopedAuthorization({
    payload,
    uid: 'u1',
    required: { appCode: 'people', resourceCode: 'employees', action: 'view' },
    object: { departmentCode: 'dept-b' }
  })

  assert.equal(allowed.allowed, true)
  assert.match(allowed.matchedGrantId || '', /^assignment:5102:/)
  assert.equal(allowed.matchedScopes?.some(scope => scope.value === 'dept-b'), true)

  const denied = evaluatePolicyBundleScopedAuthorization({
    payload,
    uid: 'u1',
    required: { appCode: 'people', resourceCode: 'employees', action: 'view' },
    object: { departmentCode: 'dept-a' }
  })

  assert.equal(denied.allowed, false)
  assert.equal(denied.reasonCode, 'scope_not_matched')
})

test('policy bundle v2 兼容字段：默认范围与 assignmentScopes 默认取交集', () => {
  const payload = {
    compatSchemaVersions: ['policy-bundle.v2'],
    subjects: [
      { subjectType: 'user', subjectCode: 'subject-u1', externalRef: 'u1', status: 'active' }
    ],
    roles: [
      { roleCode: 'people-viewer', roleName: '人员查看', appCode: null, status: 'active', isAssignable: 1 }
    ],
    roleAssignments: [
      { assignmentId: 5103, subjectType: 'user', subjectCode: 'subject-u1', roleCode: 'people-viewer', status: 'active' }
    ],
    rolePermissionGrants: [
      { grantId: 'role-permission:people-viewer:people:employees:view:custom::1', roleCode: 'people-viewer', appCode: 'people', resourceCode: 'employees', action: 'view', status: 'active' }
    ],
    roleDefaultScopes: [
      { roleCode: 'people-viewer', appCode: 'people', resourceCode: 'employees', action: 'view', scopeDimension: 'department', scopePredicate: 'tree', scopeValue: 'dept-root', status: 'active' }
    ],
    assignmentScopes: [
      { assignmentId: 5103, appCode: 'people', resourceCode: 'employees', action: 'view', scopeDimension: 'department', scopePredicate: 'self', scopeValue: 'dept-sales', status: 'active' }
    ]
  }

  const allowed = evaluatePolicyBundleScopedAuthorization({
    payload,
    uid: 'u1',
    required: { appCode: 'people', resourceCode: 'employees', action: 'view' },
    object: { departmentCode: 'dept-sales', departmentTree: ['dept-root', 'dept-sales'] }
  })

  assert.equal(allowed.allowed, true)
  assert.match(allowed.matchedGrantId || '', /^assignment:5103:/)
  assert.equal(allowed.matchedScopes?.some(scope => scope.source === 'role_default' && scope.value === 'dept-root'), true)
  assert.equal(allowed.matchedScopes?.some(scope => scope.source === 'assignment' && scope.value === 'dept-sales'), true)

  const outsideAssignment = evaluatePolicyBundleScopedAuthorization({
    payload,
    uid: 'u1',
    required: { appCode: 'people', resourceCode: 'employees', action: 'view' },
    object: { departmentCode: 'dept-finance', departmentTree: ['dept-root', 'dept-finance'] }
  })

  assert.equal(outsideAssignment.allowed, false)
  assert.equal(outsideAssignment.reasonCode, 'scope_not_matched')

  const outsideDefault = evaluatePolicyBundleScopedAuthorization({
    payload,
    uid: 'u1',
    required: { appCode: 'people', resourceCode: 'employees', action: 'view' },
    object: { departmentCode: 'dept-sales', departmentTree: ['dept-other-root', 'dept-sales'] }
  })

  assert.equal(outsideDefault.allowed, false)
  assert.equal(outsideDefault.reasonCode, 'scope_not_matched')
})

test('policy bundle v2 兼容字段：assignmentScopes inherit 仅继承角色默认范围', () => {
  const payload = {
    compatSchemaVersions: ['policy-bundle.v2'],
    subjects: [
      { subjectType: 'user', subjectCode: 'subject-u1', externalRef: 'u1', status: 'active' }
    ],
    roles: [
      { roleCode: 'people-viewer', roleName: '人员查看', appCode: null, status: 'active', isAssignable: 1 }
    ],
    roleAssignments: [
      { assignmentId: 5104, subjectType: 'user', subjectCode: 'subject-u1', roleCode: 'people-viewer', status: 'active' }
    ],
    rolePermissionGrants: [
      { grantId: 'role-permission:people-viewer:people:employees:view:custom::1', roleCode: 'people-viewer', appCode: 'people', resourceCode: 'employees', action: 'view', status: 'active' }
    ],
    roleDefaultScopes: [
      { roleCode: 'people-viewer', appCode: 'people', resourceCode: 'employees', action: 'view', scopeDimension: 'department', scopePredicate: 'tree', scopeValue: 'dept-root', status: 'active' }
    ],
    assignmentScopes: [
      { assignmentId: 5104, appCode: 'people', resourceCode: 'employees', action: 'view', scopeDimension: 'department', scopePredicate: 'self', scopeValue: 'dept-sales', scopeMode: 'inherit', status: 'active' }
    ]
  }

  const allowedByDefault = evaluatePolicyBundleScopedAuthorization({
    payload,
    uid: 'u1',
    required: { appCode: 'people', resourceCode: 'employees', action: 'view' },
    object: { departmentCode: 'dept-finance', departmentTree: ['dept-root', 'dept-finance'] }
  })

  assert.equal(allowedByDefault.allowed, true)
  assert.match(allowedByDefault.matchedGrantId || '', /^assignment:5104:/)
  assert.equal(allowedByDefault.matchedScopes?.some(scope => scope.source === 'role_default' && scope.value === 'dept-root'), true)
  assert.equal(allowedByDefault.matchedScopes?.some(scope => scope.source === 'assignment'), false)

  const deniedByDefault = evaluatePolicyBundleScopedAuthorization({
    payload,
    uid: 'u1',
    required: { appCode: 'people', resourceCode: 'employees', action: 'view' },
    object: { departmentCode: 'dept-sales', departmentTree: ['dept-other-root', 'dept-sales'] }
  })

  assert.equal(deniedByDefault.allowed, false)
  assert.equal(deniedByDefault.reasonCode, 'scope_not_matched')
})

test('policy bundle v2 兼容字段：baselineGrants 可生成 scoped grant', () => {
  const payload = {
    subjects: [
      { subjectType: 'user', subjectCode: 'subject-u1', externalRef: 'u1', status: 'active' },
      { subjectType: 'user', subjectCode: 'subject-excluded', externalRef: 'u-excluded', status: 'active' }
    ],
    baselineGrants: [
      { grantId: 'baseline:codocs:documents:create:subject:self', appCode: 'codocs', resourceCode: 'documents', action: 'create', scopeDimension: 'subject', scopePredicate: 'self', scopeValue: null, sourceType: 'baseline', status: 'active', excludedSubjectCodes: ['u-excluded'] }
    ]
  }

  const allowed = evaluatePolicyBundleScopedAuthorization({
    payload,
    uid: 'u1',
    required: { appCode: 'codocs', resourceCode: 'documents', action: 'create' },
    object: { actorUid: 'u1', ownerUid: 'u1' }
  })

  assert.equal(allowed.allowed, true)
  assert.match(allowed.matchedGrantId || '', /^baseline:codocs:documents:create/)

  const denied = evaluatePolicyBundleScopedAuthorization({
    payload,
    uid: 'u1',
    includeBaseline: false,
    required: { appCode: 'codocs', resourceCode: 'documents', action: 'create' },
    object: { actorUid: 'u1', ownerUid: 'u1' }
  })

  assert.equal(denied.allowed, false)
  assert.equal(denied.reasonCode, 'no_permission')

  const excluded = evaluatePolicyBundleScopedAuthorization({
    payload,
    uid: 'u-excluded',
    required: { appCode: 'codocs', resourceCode: 'documents', action: 'create' },
    object: { actorUid: 'u-excluded', ownerUid: 'u-excluded' }
  })

  assert.equal(excluded.allowed, false)
  assert.equal(excluded.reasonCode, 'no_permission')
})

test('baseline、角色范围与模板 override 保持独立，不能跨授权单元拼接', () => {
  const payload = {
    subjects: [
      { subjectType: 'user', subjectCode: 'subject-u1', externalRef: 'u1', status: 'active' }
    ],
    roles: [
      { roleCode: 'people-editor', roleName: 'People Editor', appCode: null, status: 'active', isAssignable: 1 },
      { roleCode: 'people-template-admin', roleName: 'People Template Admin', appCode: null, status: 'active', isAssignable: 1 }
    ],
    roleAssignments: [
      { assignmentId: 5201, subjectType: 'user', subjectCode: 'subject-u1', roleCode: 'people-editor', status: 'active' }
    ],
    templateBindings: [
      { subjectType: 'user', subjectCode: 'subject-u1', templateCode: 'people-ops', status: 'active' }
    ],
    templateRoles: [
      { templateCode: 'people-ops', roleCode: 'people-template-admin' }
    ],
    templateOverrides: [
      { subjectType: 'user', subjectCode: 'subject-u1', roleCode: 'people-template-admin', sourceTemplateCode: 'people-ops', overrideType: 'exclude', status: 'active' }
    ],
    rolePermissionGrants: [
      { grantId: 'role-permission:people-editor:people:employees:edit', roleCode: 'people-editor', appCode: 'people', resourceCode: 'employees', action: 'edit', status: 'active' },
      { grantId: 'role-permission:people-template-admin:people:employees:admin', roleCode: 'people-template-admin', appCode: 'people', resourceCode: 'employees', action: 'admin', status: 'active' }
    ],
    roleDefaultScopes: [
      { roleCode: 'people-editor', appCode: 'people', resourceCode: 'employees', action: 'edit', scopeDimension: 'department', scopePredicate: 'self', scopeValue: 'dept-a', status: 'active' },
      { roleCode: 'people-template-admin', appCode: 'people', resourceCode: 'employees', action: 'admin', scopeDimension: 'tenant', scopePredicate: 'global', scopeValue: null, status: 'active' }
    ],
    baselineGrants: [
      { grantId: 'baseline:people:employees:view:subject:self', appCode: 'people', resourceCode: 'employees', action: 'view', scopeDimension: 'subject', scopePredicate: 'self', scopeValue: null, sourceType: 'baseline', status: 'active' }
    ]
  }

  const baselineView = evaluatePolicyBundleScopedAuthorization({
    payload,
    uid: 'u1',
    required: { appCode: 'people', resourceCode: 'employees', action: 'view' },
    object: { actorUid: 'u1', ownerUid: 'u1', departmentCode: 'dept-b' }
  })
  assert.equal(baselineView.allowed, true)
  assert.match(baselineView.matchedGrantId || '', /^baseline:/)

  const crossGrantEdit = evaluatePolicyBundleScopedAuthorization({
    payload,
    uid: 'u1',
    required: { appCode: 'people', resourceCode: 'employees', action: 'edit' },
    object: { actorUid: 'u1', ownerUid: 'u1', departmentCode: 'dept-b' }
  })
  assert.equal(crossGrantEdit.allowed, false)
  assert.equal(crossGrantEdit.reasonCode, 'scope_not_matched')

  const excludedTemplateAdmin = evaluatePolicyBundleScopedAuthorization({
    payload,
    uid: 'u1',
    required: { appCode: 'people', resourceCode: 'employees', action: 'admin' },
    object: { actorUid: 'u1', ownerUid: 'u1', departmentCode: 'dept-b' }
  })
  assert.equal(excludedTemplateAdmin.allowed, false)
  assert.equal(excludedTemplateAdmin.reasonCode, 'no_permission')
})

test('policy bundle v2 兼容字段：actionImplications 驱动 scoped authorization 动作蕴含', () => {
  const payload = {
    subjects: [
      { subjectType: 'user', subjectCode: 'subject-u1', externalRef: 'u1', status: 'active' }
    ],
    roles: [
      { roleCode: 'reviewer', roleName: '审阅人', appCode: null, status: 'active', isAssignable: 1 }
    ],
    roleAssignments: [
      { assignmentId: 5003, subjectType: 'user', subjectCode: 'subject-u1', roleCode: 'reviewer', status: 'active' }
    ],
    rolePermissions: [
      { roleCode: 'reviewer', appCode: 'codocs', resourceCode: 'documents', action: 'review' }
    ],
    actionImplications: [
      { action: 'review', implies: ['view'], source: 'tenant', scope: 'global' }
    ]
  }

  const allowed = evaluatePolicyBundleScopedAuthorization({
    payload,
    uid: 'u1',
    required: { appCode: 'codocs', resourceCode: 'documents', action: 'view' },
    object: {}
  })

  assert.equal(allowed.allowed, true)
  assert.match(allowed.matchedGrantId || '', /^assignment:5003:/)
})

test('policy bundle v2 范围授权：对象上下文支持部门树、项目、客户、指派对象、关系别名和环境谓词', () => {
  const payload = {
    compatSchemaVersions: ['policy-bundle.v2'],
    subjects: [
      { subjectType: 'user', subjectCode: 'subject-u1', externalRef: 'u1', status: 'active' }
    ],
    roles: [
      { roleCode: 'scoped-operator', roleName: '范围操作员', appCode: null, status: 'active', isAssignable: 1 }
    ],
    roleAssignments: [
      { assignmentId: 5201, subjectType: 'user', subjectCode: 'subject-u1', roleCode: 'scoped-operator', status: 'active' }
    ],
    rolePermissionGrants: [
      { grantId: 'role-permission:scoped-operator:people:employees:view:department-tree', roleCode: 'scoped-operator', appCode: 'people', resourceCode: 'employees', action: 'view', status: 'active' },
      { grantId: 'role-permission:scoped-operator:aims:projects:edit:project-member', roleCode: 'scoped-operator', appCode: 'aims', resourceCode: 'projects', action: 'edit', status: 'active' },
      { grantId: 'role-permission:scoped-operator:altoc:customers:view:customer-team', roleCode: 'scoped-operator', appCode: 'altoc', resourceCode: 'customers', action: 'view', status: 'active' },
      { grantId: 'role-permission:scoped-operator:workflow:workflow_tasks:view:assigned', roleCode: 'scoped-operator', appCode: 'workflow', resourceCode: 'workflow_tasks', action: 'view', status: 'active' },
      { grantId: 'role-permission:scoped-operator:codocs:reviews:approve:reviewer', roleCode: 'scoped-operator', appCode: 'codocs', resourceCode: 'reviews', action: 'approve', status: 'active' },
      { grantId: 'role-permission:scoped-operator:platform:deployments:deploy:prod', roleCode: 'scoped-operator', appCode: 'platform', resourceCode: 'deployments', action: 'deploy', status: 'active' }
    ],
    assignmentScopes: [
      { assignmentId: 5201, appCode: 'people', resourceCode: 'employees', action: 'view', scopeDimension: 'department', scopePredicate: 'tree', scopeValue: 'dept-root', status: 'active' },
      { assignmentId: 5201, appCode: 'aims', resourceCode: 'projects', action: 'edit', scopeDimension: 'project', scopePredicate: 'member', scopeValue: 'PRJ-001', status: 'active' },
      { assignmentId: 5201, appCode: 'altoc', resourceCode: 'customers', action: 'view', scopeDimension: 'customer', scopePredicate: 'team', scopeValue: null, status: 'active' },
      { assignmentId: 5201, appCode: 'workflow', resourceCode: 'workflow_tasks', action: 'view', scopeDimension: 'object', scopePredicate: 'assigned', scopeValue: null, status: 'active' },
      { assignmentId: 5201, appCode: 'codocs', resourceCode: 'reviews', action: 'approve', scopeDimension: 'relation', scopePredicate: 'reviewer', scopeValue: null, status: 'active' },
      { assignmentId: 5201, appCode: 'platform', resourceCode: 'deployments', action: 'deploy', scopeDimension: 'environment', scopePredicate: 'prod', scopeValue: null, status: 'active' }
    ]
  }

  const departmentAllowed = evaluatePolicyBundleScopedAuthorization({
    payload,
    uid: 'u1',
    required: { appCode: 'people', resourceCode: 'employees', action: 'view' },
    object: { departmentCode: 'dept-sales', departmentTree: ['dept-root', 'dept-sales'] }
  })
  assert.equal(departmentAllowed.allowed, true)

  const departmentDenied = evaluatePolicyBundleScopedAuthorization({
    payload,
    uid: 'u1',
    required: { appCode: 'people', resourceCode: 'employees', action: 'view' },
    object: { departmentCode: 'dept-finance', departmentTree: ['dept-other-root', 'dept-finance'] }
  })
  assert.equal(departmentDenied.allowed, false)
  assert.equal(departmentDenied.reasonCode, 'scope_not_matched')

  const projectAllowed = evaluatePolicyBundleScopedAuthorization({
    payload,
    uid: 'u1',
    required: { appCode: 'aims', resourceCode: 'projects', action: 'edit' },
    object: { actorUid: 'u1', projectCode: 'PRJ-001', projectMemberUids: ['u1'] }
  })
  assert.equal(projectAllowed.allowed, true)

  const projectDenied = evaluatePolicyBundleScopedAuthorization({
    payload,
    uid: 'u1',
    required: { appCode: 'aims', resourceCode: 'projects', action: 'edit' },
    object: { actorUid: 'u1', projectCode: 'PRJ-002', projectMemberUids: ['u1'] }
  })
  assert.equal(projectDenied.allowed, false)
  assert.equal(projectDenied.reasonCode, 'scope_not_matched')

  const customerAllowed = evaluatePolicyBundleScopedAuthorization({
    payload,
    uid: 'u1',
    required: { appCode: 'altoc', resourceCode: 'customers', action: 'view' },
    object: { actorUid: 'u1', customerTeamUids: ['u1', 'u2'] }
  })
  assert.equal(customerAllowed.allowed, true)

  const customerDenied = evaluatePolicyBundleScopedAuthorization({
    payload,
    uid: 'u1',
    required: { appCode: 'altoc', resourceCode: 'customers', action: 'view' },
    object: { actorUid: 'u1', customerTeamUids: ['u2'] }
  })
  assert.equal(customerDenied.allowed, false)
  assert.equal(customerDenied.reasonCode, 'scope_not_matched')

  const assignedAllowed = evaluatePolicyBundleScopedAuthorization({
    payload,
    uid: 'u1',
    required: { appCode: 'workflow', resourceCode: 'workflow_tasks', action: 'view' },
    object: { actorUid: 'u1', assignedUids: ['u1'] }
  })
  assert.equal(assignedAllowed.allowed, true)

  const assignedDenied = evaluatePolicyBundleScopedAuthorization({
    payload,
    uid: 'u1',
    required: { appCode: 'workflow', resourceCode: 'workflow_tasks', action: 'view' },
    object: { actorUid: 'u1', assignedUids: ['u2'] }
  })
  assert.equal(assignedDenied.allowed, false)
  assert.equal(assignedDenied.reasonCode, 'scope_not_matched')

  const relationAllowed = evaluatePolicyBundleScopedAuthorization({
    payload,
    uid: 'u1',
    required: { appCode: 'codocs', resourceCode: 'reviews', action: 'approve' },
    object: { matchedRelations: ['relation:reviewer'] }
  })
  assert.equal(relationAllowed.allowed, true)

  const relationDenied = evaluatePolicyBundleScopedAuthorization({
    payload,
    uid: 'u1',
    required: { appCode: 'codocs', resourceCode: 'reviews', action: 'approve' },
    object: { matchedRelations: ['relation:owner'] }
  })
  assert.equal(relationDenied.allowed, false)
  assert.equal(relationDenied.reasonCode, 'scope_not_matched')

  const environmentAllowed = evaluatePolicyBundleScopedAuthorization({
    payload,
    uid: 'u1',
    required: { appCode: 'platform', resourceCode: 'deployments', action: 'deploy' },
    object: { deploymentEnvironment: 'prod' }
  })
  assert.equal(environmentAllowed.allowed, true)

  const environmentDenied = evaluatePolicyBundleScopedAuthorization({
    payload,
    uid: 'u1',
    required: { appCode: 'platform', resourceCode: 'deployments', action: 'deploy' },
    object: { deploymentEnvironment: 'test' }
  })
  assert.equal(environmentDenied.allowed, false)
  assert.equal(environmentDenied.reasonCode, 'scope_not_matched')
})
