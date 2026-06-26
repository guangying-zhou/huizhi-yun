import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  evaluateFoundationScopedAuthorization,
  foundationGrantScopeMatches,
  foundationScopeSetMatches,
  type FoundationScopedAuthorizationGrant
} from '../server/utils/scopeEvaluator.ts'

function grant(partial: Partial<FoundationScopedAuthorizationGrant>): FoundationScopedAuthorizationGrant {
  return {
    grantId: 'grant-1',
    permissions: [
      { appCode: 'aims', resourceCode: 'project', action: 'view' }
    ],
    ...partial
  }
}

test('scope evaluator：同一维度多个范围按 OR 匹配', () => {
  assert.equal(
    foundationScopeSetMatches([
      { dimension: 'department', predicate: 'self', value: 'dept-a', source: 'assignment' },
      { dimension: 'department', predicate: 'self', value: 'dept-b', source: 'assignment' }
    ], {
      departmentCode: 'dept-b'
    }),
    true
  )
})

test('scope evaluator：不同维度范围按 AND 匹配', () => {
  const scopes = [
    { dimension: 'department', predicate: 'self', value: 'dept-a', source: 'assignment' },
    { dimension: 'environment', predicate: 'prod', source: 'assignment' }
  ]

  assert.equal(foundationScopeSetMatches(scopes, { departmentCode: 'dept-a', environment: 'prod' }), true)
  assert.equal(foundationScopeSetMatches(scopes, { departmentCode: 'dept-a', environment: 'test' }), false)
})

test('scope evaluator：多授权单元按 OR 匹配', () => {
  const decision = evaluateFoundationScopedAuthorization({
    grants: [
      grant({
        grantId: 'dept-a',
        scopes: [{ dimension: 'department', predicate: 'self', value: 'dept-a', source: 'assignment' }]
      }),
      grant({
        grantId: 'dept-b',
        scopes: [{ dimension: 'department', predicate: 'self', value: 'dept-b', source: 'assignment' }]
      })
    ],
    required: { appCode: 'aims', resourceCode: 'project', action: 'view' },
    object: { departmentCode: 'dept-b' }
  })

  assert.equal(decision.allowed, true)
  assert.equal(decision.matchedGrantId, 'dept-b')
})

test('scope evaluator：权限和范围不能跨授权拼接', () => {
  const decision = evaluateFoundationScopedAuthorization({
    grants: [
      grant({
        grantId: 'edit-wrong-dept',
        permissions: [{ appCode: 'aims', resourceCode: 'project', action: 'edit' }],
        scopes: [{ dimension: 'department', predicate: 'self', value: 'dept-b', source: 'assignment' }]
      }),
      grant({
        grantId: 'view-right-dept',
        permissions: [{ appCode: 'aims', resourceCode: 'project', action: 'view' }],
        scopes: [{ dimension: 'department', predicate: 'self', value: 'dept-a', source: 'assignment' }]
      })
    ],
    required: { appCode: 'aims', resourceCode: 'project', action: 'edit' },
    object: { departmentCode: 'dept-a' }
  })

  assert.equal(decision.allowed, false)
  assert.equal(decision.reasonCode, 'scope_not_matched')
})

test('scope evaluator：角色默认范围与授权范围取交集', () => {
  assert.equal(
    foundationGrantScopeMatches({
      defaultScopes: [{ dimension: 'project', predicate: 'member', source: 'role_default' }],
      assignmentScopes: [{ dimension: 'project', predicate: 'member', value: 'project-a', source: 'assignment' }]
    }, {
      actorUid: 'u1',
      projectCode: 'project-a',
      projectMemberUids: ['u1']
    }),
    true
  )
  assert.equal(
    foundationGrantScopeMatches({
      defaultScopes: [{ dimension: 'project', predicate: 'member', source: 'role_default' }],
      assignmentScopes: [{ dimension: 'project', predicate: 'member', value: 'project-a', source: 'assignment' }]
    }, {
      actorUid: 'u1',
      projectCode: 'project-b',
      projectMemberUids: ['u1']
    }),
    false
  )
})

test('scope evaluator：支持部门树、项目成员、所有者关系和全租户范围', () => {
  assert.equal(
    foundationScopeSetMatches([
      { dimension: 'department', predicate: 'tree', value: 'dept-root', source: 'assignment' }
    ], {
      departmentCode: 'dept-leaf',
      departmentTree: ['dept-root', 'dept-child', 'dept-leaf']
    }),
    true
  )
  assert.equal(
    foundationScopeSetMatches([
      { dimension: 'project', predicate: 'member', source: 'relation' }
    ], {
      actorUid: 'u1',
      projectMemberUids: ['u1', 'u2']
    }),
    true
  )
  assert.equal(
    foundationScopeSetMatches([
      { dimension: 'project', predicate: 'owner', value: 'project-a', source: 'relation' }
    ], {
      actorUid: 'u1',
      projectCode: 'project-a',
      projectOwnerUid: 'u1'
    }),
    true
  )
  assert.equal(
    foundationScopeSetMatches([
      { dimension: 'tenant', predicate: 'global', source: 'baseline' }
    ]),
    true
  )
})
