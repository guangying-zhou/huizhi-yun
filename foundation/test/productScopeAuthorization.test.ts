import { test } from 'node:test'
import assert from 'node:assert/strict'
import { foundationScopeSetMatches } from '../server/utils/scopeEvaluator.ts'
import { evaluatePolicyBundleScopedAuthorization } from '../server/utils/applicationAuthorization.ts'

const object = { actorUid: 'u1', productCode: 'P-A', productMemberUids: ['u1'], productManagerUids: ['u1'] }

test('product scope requires explicit product facts and fails closed for unknown predicates', () => {
  for (const predicate of ['member', 'manager']) {
    const scope = [{ dimension: 'product', predicate, value: 'P-A' }]
    assert.equal(foundationScopeSetMatches(scope, object), true)
    assert.equal(foundationScopeSetMatches(scope, { ...object, productCode: 'p-a' }), false)
    assert.equal(foundationScopeSetMatches(scope, { ...object, actorUid: 'u2' }), false)
    assert.equal(foundationScopeSetMatches(scope, { ...object, productCode: undefined }), false)
    assert.equal(foundationScopeSetMatches(scope, {
      actorUid: 'u1', productCode: 'P-A', ownerUid: 'u1', projectMemberUids: ['u1']
    }), false)
  }
  assert.equal(foundationScopeSetMatches([{ dimension: 'product', predicate: 'code', value: 'P-A' }], {
    productCode: 'P-A'
  }), true)
  assert.equal(foundationScopeSetMatches([{ dimension: 'product', predicate: 'owner', value: 'P-A' }], {
    ...object, product: 'P-A', ownerUid: 'u1'
  }), false)
  assert.equal(foundationScopeSetMatches([{ dimension: 'product', predicate: 'manager' }], {
    ...object, productManagerUids: []
  }), false)
})

test('legacy product manager role scope parses as the manager relation, not equals:manager', () => {
  const policy = payload()
  const scope = policy.roleDefaultScopes[1]!
  delete (scope as { scopePredicate?: string }).scopePredicate
  Object.assign(scope, { scopeType: 'product', scopeValue: 'manager' })
  const required = { appCode: 'aims', resourceCode: 'product_priorities', action: 'prioritize' }
  const input = { payload: policy, uid: 'u1', required, object }
  assert.equal(evaluatePolicyBundleScopedAuthorization(input).allowed, true)
  assert.equal(evaluatePolicyBundleScopedAuthorization({ ...input, object: { ...object, productManagerUids: [] } }).allowed, false)
  assert.equal(evaluatePolicyBundleScopedAuthorization({ ...input, object: { ...object, actorUid: 'u2' } }).allowed, false)
  Object.assign(scope, { scopePredicate: 'equals', scopeValue: 'manager' })
  assert.equal(evaluatePolicyBundleScopedAuthorization(input).allowed, false)
})

function payload() {
  return {
    subjects: [{ subjectType: 'user', subjectCode: 'subject-u1', externalRef: 'u1', status: 'active' }],
    roles: ['custom-reader', 'custom-decider', 'system_admin'].map(roleCode => ({
      roleCode, appCode: null, status: 'active', isAssignable: true, source: 'custom'
    })),
    roleAssignments: ['custom-reader', 'custom-decider', 'system_admin'].map((roleCode, index) => ({
      assignmentId: index + 1, subjectType: 'user', subjectCode: 'subject-u1', roleCode, status: 'active'
    })),
    rolePermissionGrants: [
      { roleCode: 'custom-reader', appCode: 'aims', resourceCode: 'product_priorities', action: 'view' },
      { roleCode: 'custom-decider', appCode: 'aims', resourceCode: 'product_priorities', action: 'prioritize' },
      { roleCode: 'system_admin', appCode: 'aims', resourceCode: 'product_priorities', action: 'admin' }
    ],
    roleDefaultScopes: [
      { roleCode: 'custom-reader', appCode: 'aims', resourceCode: 'product_priorities', action: 'view', scopeDimension: 'product', scopePredicate: 'member', status: 'active' },
      { roleCode: 'custom-decider', appCode: 'aims', resourceCode: 'product_priorities', action: 'prioritize', scopeDimension: 'product', scopePredicate: 'manager', status: 'active' }
    ],
    assignmentScopes: [
      { assignmentId: 2, appCode: 'aims', resourceCode: 'product_priorities', action: 'prioritize', scopeDimension: 'product', scopePredicate: 'code', scopeValue: 'P-A', scopeMode: 'intersect', status: 'active' }
    ]
  }
}

test('product grants preserve merged custom roles, simulation isolation and explicit decision action', () => {
  const input = { payload: payload(), uid: 'u1', object, required: {
    appCode: 'aims', resourceCode: 'product_priorities', action: 'prioritize'
  } }
  assert.equal(evaluatePolicyBundleScopedAuthorization({ ...input, requestedRoleCode: 'custom-reader' }).allowed, true)
  assert.equal(evaluatePolicyBundleScopedAuthorization({ ...input, requestedRoleCode: 'custom-reader',
    authorizationMode: 'role_simulation', allowRoleSimulation: true }).allowed, false)
  assert.equal(evaluatePolicyBundleScopedAuthorization({ ...input, requestedRoleCode: 'system_admin',
    authorizationMode: 'role_simulation', allowRoleSimulation: true }).allowed, false)
  assert.equal(evaluatePolicyBundleScopedAuthorization({ ...input, object: { ...object, productCode: 'P-B' } }).allowed, false)
  assert.equal(evaluatePolicyBundleScopedAuthorization({ ...input, object: { ...object, productManagerUids: [] } }).allowed, false)
  input.payload.roleAssignments[1]!.status = 'expired'
  assert.equal(evaluatePolicyBundleScopedAuthorization(input).allowed, false)
})
