import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  evaluateFoundationScopedAuthorization,
  foundationScopeSetMatches,
  type FoundationObjectContext,
  type FoundationScopePredicate
} from '../server/utils/scopeEvaluator.ts'
import { evaluatePolicyBundleScopedAuthorization } from '../server/utils/applicationAuthorization.ts'

const source = 'assignment' as const
const member = (value?: string): FoundationScopePredicate => ({ dimension: 'project', predicate: 'member', value, source })
const owner = (value?: string): FoundationScopePredicate => ({ dimension: 'project', predicate: 'owner', value, source })
const code = (value: string): FoundationScopePredicate => ({ dimension: 'project', predicate: 'code', value, source })

function matches(scopes: FoundationScopePredicate[], object?: FoundationObjectContext) {
  return foundationScopeSetMatches(scopes, object)
}

describe('Foundation project scope semantics', () => {
  test('project:member fails closed without actor, members, or matching project code', () => {
    assert.equal(matches([member('PRJ-1')]), false)
    assert.equal(matches([member('PRJ-1')], { projectCode: 'PRJ-1' }), false)
    assert.equal(matches([member('PRJ-1')], { actorUid: 'u1', projectCode: 'PRJ-1' }), false)
    assert.equal(matches([member('PRJ-1')], { actorUid: 'u1', projectCode: 'PRJ-1', projectMemberUids: [] }), false)
    assert.equal(matches([member('PRJ-1')], { actorUid: 'u1', projectCode: 'PRJ-2', projectMemberUids: ['u1'] }), false)
  })

  test('member, owner, and explicit code retain distinct positive semantics', () => {
    assert.equal(matches([member('PRJ-1')], { actorUid: 'u1', projectCode: 'PRJ-1', projectMemberUids: ['u1'] }), true)
    assert.equal(matches([owner('PRJ-1')], { actorUid: 'u1', projectCode: 'PRJ-1', projectOwnerUid: 'u1' }), true)
    assert.equal(matches([code('PRJ-1')], { projectCode: 'PRJ-1' }), true)
    assert.equal(matches([code('PRJ-1')], { actorUid: 'u1', projectCode: 'PRJ-2', projectMemberUids: ['u1'] }), false)
  })

  test('L3 uses cross-dimension AND and same-dimension OR', () => {
    const scopes: FoundationScopePredicate[] = [
      { dimension: 'department', predicate: 'self', value: 'DEPT-1', source },
      code('PRJ-1')
    ]
    assert.equal(matches(scopes, { departmentCode: 'DEPT-1', projectCode: 'PRJ-1' }), true)
    assert.equal(matches(scopes, { departmentCode: 'DEPT-2', projectCode: 'PRJ-1' }), false)
    assert.equal(matches([code('PRJ-1'), code('PRJ-2')], { projectCode: 'PRJ-2' }), true)
  })

  test('one grant cannot satisfy department and project scopes from different objects', () => {
    const decision = evaluateFoundationScopedAuthorization({
      grants: [{
        grantId: 'l3',
        permissions: [{ appCode: 'aims', resourceCode: 'projects', action: 'view' }],
        scopes: [
          { dimension: 'department', predicate: 'self', value: 'DEPT-1', source },
          code('PRJ-1')
        ]
      }],
      required: { appCode: 'aims', resourceCode: 'projects', action: 'view' },
      object: { departmentCode: 'DEPT-1', projectCode: 'PRJ-2' }
    })
    assert.equal(decision.allowed, false)
    assert.equal(decision.reasonCode, 'scope_not_matched')
  })

  test('legacy bundle project value without predicate remains member-bound and cannot expand to code-only', () => {
    const payload = {
      subjects: [{ subjectType: 'user', subjectCode: 'subject-u1', externalRef: 'u1', status: 'active' }],
      baselineGrants: [{
        grantId: 'legacy-project',
        appCode: 'aims',
        resourceCode: 'projects',
        action: 'view',
        scopeDimension: 'project',
        scopeValue: 'PRJ-1',
        sourceType: 'baseline',
        status: 'active'
      }]
    }
    const codeOnly = evaluatePolicyBundleScopedAuthorization({
      payload,
      uid: 'u1',
      required: { appCode: 'aims', resourceCode: 'projects', action: 'view' },
      object: { actorUid: 'u1', projectCode: 'PRJ-1', projectMemberUids: [] }
    })
    assert.equal(codeOnly.allowed, false)
    assert.equal(codeOnly.reasonCode, 'scope_not_matched')

    const memberMatch = evaluatePolicyBundleScopedAuthorization({
      payload,
      uid: 'u1',
      required: { appCode: 'aims', resourceCode: 'projects', action: 'view' },
      object: { actorUid: 'u1', projectCode: 'PRJ-1', projectMemberUids: ['u1'] }
    })
    assert.equal(memberMatch.allowed, true)
    assert.equal(memberMatch.matchedScopes?.[0]?.predicate, 'member')
  })

  test('bundle project predicate=code is explicitly code-only', () => {
    const payload = {
      subjects: [{ subjectType: 'user', subjectCode: 'subject-u1', externalRef: 'u1', status: 'active' }],
      baselineGrants: [{
        grantId: 'explicit-project-code',
        appCode: 'aims',
        resourceCode: 'projects',
        action: 'view',
        scopeDimension: 'project',
        scopePredicate: 'code',
        scopeValue: 'PRJ-1',
        sourceType: 'baseline',
        status: 'active'
      }]
    }
    const exactCode = evaluatePolicyBundleScopedAuthorization({
      payload,
      uid: 'u1',
      required: { appCode: 'aims', resourceCode: 'projects', action: 'view' },
      object: { projectCode: 'PRJ-1' }
    })
    assert.equal(exactCode.allowed, true)
    assert.equal(exactCode.matchedScopes?.[0]?.predicate, 'code')

    const wrongCode = evaluatePolicyBundleScopedAuthorization({
      payload,
      uid: 'u1',
      required: { appCode: 'aims', resourceCode: 'projects', action: 'view' },
      object: { actorUid: 'u1', projectCode: 'PRJ-2', projectMemberUids: ['u1'] }
    })
    assert.equal(wrongCode.allowed, false)
  })
})
