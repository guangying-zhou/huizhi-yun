import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import { candidateActionsForRequiredAction } from '../server/utils/permissionActions.ts'

const OPS_KNOWN_ACTIONS = ['view', 'edit', 'admin', 'release', 'confirm', 'deploy'] as const

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

// 复刻 authorization.ts checkPermission 的过滤判定：
// 用户“持有的动作集合” heldActions 是否满足“请求要求的动作” requiredAction。
// 等价于 ops SQL RBAC 中 `prp.action IN (...)` 的候选动作过滤。
function isAllowed(heldActions: string[], requiredAction: string): boolean {
  const acceptedActions = candidateActionsForRequiredAction(requiredAction, OPS_KNOWN_ACTIONS)
  return heldActions.some(action => acceptedActions.includes(action))
}

describe('candidateActionsForRequiredAction 蕴含方向', () => {
  test('请求 view 接受 view/edit/admin', () => {
    assert.deepEqual(candidateActionsForRequiredAction('view', OPS_KNOWN_ACTIONS), ['view', 'edit', 'admin'])
  })

  test('请求 edit 接受 edit/admin', () => {
    assert.deepEqual(candidateActionsForRequiredAction('edit', OPS_KNOWN_ACTIONS), ['edit', 'admin'])
  })

  test('请求 admin 只接受 admin', () => {
    assert.deepEqual(candidateActionsForRequiredAction('admin', OPS_KNOWN_ACTIONS), ['admin'])
  })

  test('敏感动作精确匹配，互不蕴含', () => {
    assert.deepEqual(candidateActionsForRequiredAction('approve', OPS_KNOWN_ACTIONS), ['approve'])
    assert.deepEqual(candidateActionsForRequiredAction('export', OPS_KNOWN_ACTIONS), ['export'])
    assert.deepEqual(candidateActionsForRequiredAction('confirm', OPS_KNOWN_ACTIONS), ['confirm'])
    assert.deepEqual(candidateActionsForRequiredAction('close', OPS_KNOWN_ACTIONS), ['close'])
    assert.deepEqual(candidateActionsForRequiredAction('deploy', OPS_KNOWN_ACTIONS), ['deploy'])
  })

  test('ops RBAC 使用 core-backed 候选动作而不是 legacy expandActions', () => {
    const rbac = source('server/utils/platformOpsRbac.ts')
    const permissionActions = source('server/utils/permissionActions.ts')

    assert.match(rbac, /candidateActionsForRequiredAction\(requiredAction, OPS_KNOWN_ACTIONS\)/)
    assert.doesNotMatch(rbac, /expandActions/)
    assert.doesNotMatch(permissionActions, /function expandActions/)
  })
})

describe('viewer/editor/admin × view/edit/admin 真值表', () => {
  const subjects: Record<string, string[]> = {
    viewer: ['view'],
    editor: ['edit'],
    admin: ['admin']
  }
  // 与 console policyAuthorization.ts hasPermissionInSnapshot 的判定结果逐格一致。
  const expected: Record<string, Record<string, boolean>> = {
    viewer: { view: true, edit: false, admin: false },
    editor: { view: true, edit: true, admin: false },
    admin: { view: true, edit: true, admin: true }
  }

  for (const [subject, held] of Object.entries(subjects)) {
    for (const required of ['view', 'edit', 'admin']) {
      const want = expected[subject][required]
      test(`${subject} 请求 ${required} => ${want}`, () => {
        assert.equal(isAllowed(held, required), want)
      })
    }
  }
})

describe('提权回归用例', () => {
  test('view 不能通过 admin 检查（原提权漏洞）', () => {
    assert.equal(isAllowed(['view'], 'admin'), false)
  })

  test('view 不能通过 edit 检查（原提权漏洞）', () => {
    assert.equal(isAllowed(['view'], 'edit'), false)
  })

  test('edit 不蕴含 approve', () => {
    assert.equal(isAllowed(['edit'], 'approve'), false)
  })

  test('admin 不蕴含 approve（与 console 一致）', () => {
    assert.equal(isAllowed(['admin'], 'approve'), false)
  })

  test('持有 approve 才能通过 approve 检查', () => {
    assert.equal(isAllowed(['approve'], 'approve'), true)
  })

  test('admin 持有者满足 view/edit/admin', () => {
    assert.equal(isAllowed(['admin'], 'view'), true)
    assert.equal(isAllowed(['admin'], 'edit'), true)
    assert.equal(isAllowed(['admin'], 'admin'), true)
  })

  test('同时持有 view 与 admin 时各层级请求均通过', () => {
    assert.equal(isAllowed(['view', 'admin'], 'view'), true)
    assert.equal(isAllowed(['view', 'admin'], 'edit'), true)
    assert.equal(isAllowed(['view', 'admin'], 'admin'), true)
  })
})
