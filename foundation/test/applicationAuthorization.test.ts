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
      { subjectType: 'user', subjectCode: 'subject-u1', externalRef: 'u1', status: 'active' }
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
      { subjectType: 'user', subjectCode: 'subject-u1', externalRef: 'u1', status: 'active' }
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
