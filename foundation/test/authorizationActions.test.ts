import assert from 'node:assert/strict'
import test from 'node:test'
import {
  authorizationActionsAllow,
  authorizationResourcesAllow
} from '../shared/utils/authorizationActions'
import { AUTHORIZATION_ACTION_GOLDEN_CASES } from '@hzy/authz-core/testing'

test('Foundation 快照适配器满足跨层共享动作黄金契约', () => {
  for (const item of AUTHORIZATION_ACTION_GOLDEN_CASES) {
    assert.equal(
      authorizationActionsAllow(item.grantedActions, item.requiredAction, item.policy),
      item.expected,
      item.id
    )
  }
})

test('资源快照复用 authz-core 的保守默认动作蕴含', () => {
  assert.equal(authorizationActionsAllow(['admin'], 'view'), true)
  assert.equal(authorizationActionsAllow(['edit'], 'view'), true)
  assert.equal(authorizationActionsAllow(['view'], 'edit'), false)
  assert.equal(authorizationActionsAllow(['admin'], 'approve'), false)
  assert.equal(authorizationActionsAllow(['admin'], 'confirm'), false)
  assert.equal(authorizationActionsAllow(['admin'], 'export'), false)
  assert.equal(authorizationActionsAllow(['admin'], 'close'), false)
  assert.equal(authorizationActionsAllow(['admin'], 'deploy'), false)
})

test('资源快照可消费 manifest actionImplications 策略', () => {
  const policy = {
    implications: {
      execute: ['view'],
      admin: ['view', 'execute']
    }
  }

  assert.equal(authorizationResourcesAllow({ workspace: ['execute'] }, 'workspace', 'view', policy), true)
  assert.equal(authorizationResourcesAllow({ workspace: ['admin'] }, 'workspace', 'execute', policy), true)
  assert.equal(authorizationResourcesAllow({ workspace: ['view'] }, 'workspace', 'execute', policy), false)
})

test('空 resource/action 与未知动作默认拒绝', () => {
  assert.equal(authorizationResourcesAllow({}, 'workspace', 'view'), false)
  assert.equal(authorizationResourcesAllow({ workspace: ['custom'] }, '', 'custom'), false)
  assert.equal(authorizationResourcesAllow({ workspace: ['custom'] }, 'workspace', ''), false)
  assert.equal(authorizationResourcesAllow({ workspace: ['custom'] }, 'workspace', 'other'), false)
})
