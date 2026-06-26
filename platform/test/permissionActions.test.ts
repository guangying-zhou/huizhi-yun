import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { expandActions } from '../server/utils/permissionActions.ts'

// 复刻 authorization.ts checkPermission 的过滤判定：
// 用户“持有的动作集合” heldActions 是否满足“请求要求的动作” requiredAction。
// 等价于 checkPermission 中 `acceptedActions.includes(permission.action)` 的过滤。
function isAllowed(heldActions: string[], requiredAction: string): boolean {
  const acceptedActions = expandActions(requiredAction)
  return heldActions.some(action => acceptedActions.includes(action))
}

describe('expandActions 蕴含方向', () => {
  test('请求 view 接受 view/edit/admin', () => {
    assert.deepEqual(expandActions('view'), ['view', 'edit', 'admin'])
  })

  test('请求 edit 接受 edit/admin', () => {
    assert.deepEqual(expandActions('edit'), ['edit', 'admin'])
  })

  test('请求 admin 只接受 admin', () => {
    assert.deepEqual(expandActions('admin'), ['admin'])
  })

  test('敏感动作精确匹配，互不蕴含', () => {
    assert.deepEqual(expandActions('approve'), ['approve'])
    assert.deepEqual(expandActions('export'), ['export'])
    assert.deepEqual(expandActions('confirm'), ['confirm'])
    assert.deepEqual(expandActions('close'), ['close'])
    assert.deepEqual(expandActions('deploy'), ['deploy'])
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
