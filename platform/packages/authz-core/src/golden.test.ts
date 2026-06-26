import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  actionSatisfies,
  evaluate,
  isEnterpriseRole,
  resolveAuthorizationMode,
  selectEffectiveRoleCodes,
  type AuthorizationGrant
} from './index.ts'

/**
 * 黄金 contract test —— 两条鉴权路径（Platform DbGrantSource / Foundation
 * BundleGrantSource）未来都应喂等价数据跑这同一套断言，结果必须一致。
 * 本文件先锁定 core 自身的判定语义，含 3.3 / 3.4 的永久回归。
 */

// --- 动作蕴含真值表：方向钉死（修 3.3）---
test('actionSatisfies 默认层级真值表', () => {
  // 持有 view
  assert.equal(actionSatisfies('view', 'view'), true)
  assert.equal(actionSatisfies('view', 'edit'), false)
  assert.equal(actionSatisfies('view', 'admin'), false) // 关键回归：view 不得通过 admin

  // 持有 edit
  assert.equal(actionSatisfies('edit', 'view'), true)
  assert.equal(actionSatisfies('edit', 'edit'), true)
  assert.equal(actionSatisfies('edit', 'admin'), false)
  assert.equal(actionSatisfies('edit', 'approve'), false) // edit 不蕴含敏感动作

  // 持有 admin
  assert.equal(actionSatisfies('admin', 'view'), true)
  assert.equal(actionSatisfies('admin', 'edit'), true)
  assert.equal(actionSatisfies('admin', 'admin'), true)
  assert.equal(actionSatisfies('admin', 'approve'), false) // 默认 admin 不蕴含 approve

  // 敏感动作精确持有
  assert.equal(actionSatisfies('approve', 'approve'), true)
  assert.equal(actionSatisfies('approve', 'view'), false)
})

test('manifest 的 implies 可覆盖默认层级，但方向仍不可逆', () => {
  const policy = { implications: { view: [], edit: ['view'], admin: ['*'] } }
  assert.equal(actionSatisfies('admin', 'approve', policy), true) // manifest 声明 admin 蕴含全部
  assert.equal(actionSatisfies('view', 'admin', policy), false) // 反向永远不成立
})

// --- 授权单元：权限并集 + 范围不跨授权拼接（文档 8.3 / 8.4）---
function grant(partial: Partial<AuthorizationGrant>): AuthorizationGrant {
  return {
    grantId: 'g',
    subjectType: 'user',
    sourceType: 'manual',
    permission: { appCode: 'aims', resourceCode: 'project', action: 'view' },
    scopes: [],
    ...partial
  }
}

test('多授权权限取并集：A 有 view、B 有 edit -> 满足 edit', () => {
  const grants = [
    grant({ grantId: 'A', permission: { appCode: 'aims', resourceCode: 'project', action: 'view' } }),
    grant({ grantId: 'B', permission: { appCode: 'aims', resourceCode: 'project', action: 'edit' } })
  ]
  const decision = evaluate({ grants, required: { appCode: 'aims', resourceCode: 'project', action: 'edit' } })
  assert.equal(decision.allowed, true)
  assert.equal(decision.matchedGrantId, 'B')
})

test('范围不跨授权拼接：A 的 edit 权限不能配 B 的部门范围', () => {
  const grants = [
    grant({
      grantId: 'A',
      permission: { appCode: 'aims', resourceCode: 'project', action: 'edit' },
      scopes: [{ dimension: 'department', predicate: 'self', value: 'deptB', source: 'assignment' }]
    }),
    grant({
      grantId: 'B',
      permission: { appCode: 'aims', resourceCode: 'project', action: 'view' },
      scopes: [{ dimension: 'department', predicate: 'self', value: 'deptA', source: 'assignment' }]
    })
  ]
  // 对 deptA 的对象请求 edit：A 有 edit 但范围 deptB 不匹配；B 范围匹配但只有 view
  const decision = evaluate({
    grants,
    required: { appCode: 'aims', resourceCode: 'project', action: 'edit' },
    object: { departmentCode: 'deptA' }
  })
  assert.equal(decision.allowed, false)
  assert.equal(decision.reasonCode, 'scope_not_matched')
})

test('同维度 OR：部门范围命中任一即可', () => {
  const grants = [
    grant({
      grantId: 'A',
      permission: { appCode: 'aims', resourceCode: 'project', action: 'view' },
      scopes: [
        { dimension: 'department', predicate: 'self', value: 'deptA', source: 'assignment' },
        { dimension: 'department', predicate: 'self', value: 'deptB', source: 'assignment' }
      ]
    })
  ]
  const decision = evaluate({
    grants,
    required: { appCode: 'aims', resourceCode: 'project', action: 'view' },
    object: { departmentCode: 'deptB' }
  })
  assert.equal(decision.allowed, true)
})

test('角色默认范围与授权关系范围分别判定：同维度也必须取交集', () => {
  const grants = [
    grant({
      grantId: 'A',
      permission: { appCode: 'aims', resourceCode: 'project', action: 'edit' },
      defaultScopes: [{ dimension: 'department', predicate: 'self', value: 'deptA', source: 'role_default' }],
      assignmentScopes: [{ dimension: 'department', predicate: 'self', value: 'deptB', source: 'assignment' }]
    })
  ]

  const denied = evaluate({
    grants,
    required: { appCode: 'aims', resourceCode: 'project', action: 'edit' },
    object: { departmentCode: 'deptA' }
  })
  assert.equal(denied.allowed, false)
  assert.equal(denied.reasonCode, 'scope_not_matched')

  const stillDenied = evaluate({
    grants,
    required: { appCode: 'aims', resourceCode: 'project', action: 'edit' },
    object: { departmentCode: 'deptB' }
  })
  assert.equal(stillDenied.allowed, false)
  assert.equal(stillDenied.reasonCode, 'scope_not_matched')

  const replaceDecision = evaluate({
    grants: [
      grant({
        grantId: 'B',
        permission: { appCode: 'aims', resourceCode: 'project', action: 'edit' },
        defaultScopes: [],
        assignmentScopes: [{ dimension: 'department', predicate: 'self', value: 'deptB', source: 'assignment' }]
      })
    ],
    required: { appCode: 'aims', resourceCode: 'project', action: 'edit' },
    object: { departmentCode: 'deptB' }
  })
  assert.equal(replaceDecision.allowed, true)
})

test('过期/未生效授权不参与判定', () => {
  const grants = [
    grant({
      grantId: 'X',
      expiresAt: '2000-01-01T00:00:00Z',
      permission: { appCode: 'aims', resourceCode: 'project', action: 'admin' }
    })
  ]
  const decision = evaluate({ grants, required: { appCode: 'aims', resourceCode: 'project', action: 'view' } })
  assert.equal(decision.allowed, false)
  assert.equal(decision.reasonCode, 'no_permission')
})

// --- 自定义角色有效性（修 3.4）---
test('isEnterpriseRole：纯租户自定义角色生效', () => {
  assert.equal(isEnterpriseRole({ appCode: null, status: 'active', isAssignable: true }), true)
  assert.equal(isEnterpriseRole({ appCode: '', status: 'active' }), true) // 默认可分配
  assert.equal(isEnterpriseRole({ appCode: null, status: 'active', isAssignable: 1 }), true)
  assert.equal(isEnterpriseRole({ appCode: null, status: 'active', isAssignable: '1' }), true)
  assert.equal(isEnterpriseRole({ appCode: 'aims', status: 'active' }), false) // 应用角色不是企业角色
  assert.equal(isEnterpriseRole({ appCode: null, status: 'archived' }), false)
  assert.equal(isEnterpriseRole({ appCode: null, status: 'active', isAssignable: false }), false)
  assert.equal(isEnterpriseRole({ appCode: null, status: 'active', isAssignable: 0 }), false)
  assert.equal(isEnterpriseRole({ appCode: null, status: 'active', isAssignable: '0' }), false)
})

test('selectEffectiveRoleCodes：普通运行默认合并全部有效角色', () => {
  const selection = selectEffectiveRoleCodes({
    availableRoleCodes: ['sales', 'finance'],
    requestedRoleCode: 'finance'
  })
  assert.equal(selection.mode, 'merged')
  assert.equal(selection.activeRoleCode, 'finance')
  assert.deepEqual(selection.roleCodes, ['sales', 'finance'])
})

test('selectEffectiveRoleCodes：只有显式角色模拟才收窄到 active role', () => {
  const selection = selectEffectiveRoleCodes({
    availableRoleCodes: ['sales', 'finance'],
    requestedRoleCode: 'finance',
    mode: 'role_simulation'
  })
  assert.equal(selection.mode, 'role_simulation')
  assert.equal(selection.activeRoleCode, 'finance')
  assert.deepEqual(selection.roleCodes, ['finance'])
})

test('selectEffectiveRoleCodes：角色模拟请求无效角色时不得回退到其他角色', () => {
  const selection = selectEffectiveRoleCodes({
    availableRoleCodes: ['sales', 'finance'],
    requestedRoleCode: 'hr',
    mode: 'role_simulation'
  })

  assert.equal(selection.mode, 'role_simulation')
  assert.equal(selection.activeRoleCode, '')
  assert.deepEqual(selection.roleCodes, [])
})

test('resolveAuthorizationMode：未被服务端允许的模拟请求降级为 merged', () => {
  assert.equal(resolveAuthorizationMode({ requestedMode: 'role_simulation' }), 'merged')
  assert.equal(resolveAuthorizationMode({ requestedMode: 'user_simulation' }), 'merged')
  assert.equal(resolveAuthorizationMode({ requestedMode: 'privileged' }), 'merged')
  assert.equal(resolveAuthorizationMode({ requestedMode: 'role_simulation', allowRoleSimulation: true }), 'role_simulation')
  assert.equal(resolveAuthorizationMode({ requestedMode: 'user_simulation', allowUserSimulation: true }), 'user_simulation')
  assert.equal(resolveAuthorizationMode({ requestedMode: 'privileged', allowPrivileged: true }), 'privileged')
})
