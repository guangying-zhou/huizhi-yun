import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { scopeMatches, type ObjectContext, type ScopePredicate } from './index.ts'

const source = 'assignment' as const
const member = (value?: string): ScopePredicate => ({ dimension: 'project', predicate: 'member', value, source })
const owner = (value?: string): ScopePredicate => ({ dimension: 'project', predicate: 'owner', value, source })
const code = (value: string): ScopePredicate => ({ dimension: 'project', predicate: 'code', value, source })

function matches(scopes: ScopePredicate[], object?: ObjectContext) {
  return scopeMatches(scopes, object)
}

describe('authz-core project scope semantics', () => {
  test('project:member fails closed without actor or explicit membership facts', () => {
    assert.equal(matches([member('PRJ-1')]), false)
    assert.equal(matches([member('PRJ-1')], { projectCode: 'PRJ-1' }), false)
    assert.equal(matches([member('PRJ-1')], { actorUid: 'u1', projectCode: 'PRJ-1' }), false)
    assert.equal(matches([member('PRJ-1')], { actorUid: 'u1', projectCode: 'PRJ-1', projectMemberUids: [] }), false)
    assert.equal(matches([member('PRJ-1')], { actorUid: 'u1', projectCode: 'PRJ-2', projectMemberUids: ['u1'] }), false)
  })

  test('project:member and project:owner accept only matching relation facts', () => {
    assert.equal(matches([member('PRJ-1')], { actorUid: 'u1', projectCode: 'PRJ-1', projectMemberUids: ['u2', 'u1'] }), true)
    assert.equal(matches([owner('PRJ-1')], { actorUid: 'u1', projectCode: 'PRJ-1', projectOwnerUid: 'u1' }), true)
    assert.equal(matches([owner('PRJ-1')], { actorUid: 'u2', projectCode: 'PRJ-1', projectOwnerUid: 'u1' }), false)
  })

  test('project:code matches only project code and does not require membership', () => {
    assert.equal(matches([code('PRJ-1')], { projectCode: 'PRJ-1' }), true)
    assert.equal(matches([code('PRJ-1')], { actorUid: 'u1', projectCode: 'PRJ-2', projectMemberUids: ['u1'] }), false)
  })

  test('L3 combines dimensions with AND and predicates in one dimension with OR', () => {
    const crossDimension: ScopePredicate[] = [
      { dimension: 'department', predicate: 'self', value: 'DEPT-1', source },
      code('PRJ-1')
    ]
    assert.equal(matches(crossDimension, { departmentCode: 'DEPT-1', projectCode: 'PRJ-1' }), true)
    assert.equal(matches(crossDimension, { departmentCode: 'DEPT-2', projectCode: 'PRJ-1' }), false)
    assert.equal(matches(crossDimension, { departmentCode: 'DEPT-1', projectCode: 'PRJ-2' }), false)

    assert.equal(matches([code('PRJ-1'), code('PRJ-2')], { projectCode: 'PRJ-2' }), true)
    assert.equal(matches([code('PRJ-1'), code('PRJ-2')], { projectCode: 'PRJ-3' }), false)
  })

  test('legacy member predicate without a value remains relation-bound', () => {
    assert.equal(matches([member()], { actorUid: 'u1', projectCode: 'PRJ-1' }), false)
    assert.equal(matches([member()], { actorUid: 'u1', projectCode: 'PRJ-1', projectMemberUids: ['u1'] }), true)
  })
})
