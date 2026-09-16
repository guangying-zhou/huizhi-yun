import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { aimsProjectListAdminScopeQueryFromGrants } from '../server/utils/aimsProjectListScopeCore.ts'

const adminPermission = { appCode: 'aims', resourceCode: 'projects', action: 'admin' }
const scope = (predicate: string, value?: string) => ({ dimension: 'project', predicate, value })
const grant = (scopes: Array<ReturnType<typeof scope>>, extra: Record<string, unknown> = {}) => ({
  permissions: [adminPermission],
  scopes,
  ...extra
})

describe('Aims project list scope query semantics', () => {
  test('keeps valued member and owner relations bound to their exact project codes', () => {
    assert.deepEqual(aimsProjectListAdminScopeQueryFromGrants([
      grant([scope('member', 'PRJ-M')]),
      grant([scope('owner', 'PRJ-O')])
    ]), {
      current_user_project_admin_member_project_codes: 'PRJ-M',
      current_user_project_admin_owner_project_codes: 'PRJ-O'
    })
  })

  test('keeps explicit code code-only and does not splice it into another grant relation', () => {
    assert.deepEqual(aimsProjectListAdminScopeQueryFromGrants([
      grant([scope('member', 'PRJ-M')]),
      grant([scope('code', 'PRJ-C')])
    ]), {
      current_user_project_admin_project_codes: 'PRJ-C',
      current_user_project_admin_member_project_codes: 'PRJ-M'
    })
  })

  test('preserves unvalued relation scopes without inventing a project code', () => {
    assert.deepEqual(aimsProjectListAdminScopeQueryFromGrants([
      grant([scope('member')]),
      grant([scope('owner')])
    ]), {
      current_user_project_admin_member_scope: '1',
      current_user_project_admin_owner_scope: '1'
    })
  })

  test('intersects default wildcard member with assignment valued member', () => {
    assert.deepEqual(aimsProjectListAdminScopeQueryFromGrants([{
      permissions: [adminPermission],
      defaultScopes: [scope('member')],
      assignmentScopes: [scope('member', 'PRJ-1')]
    }]), {
      current_user_project_admin_member_project_codes: 'PRJ-1'
    })
  })

  test('intersects owner value groups and fails closed when values do not overlap', () => {
    assert.deepEqual(aimsProjectListAdminScopeQueryFromGrants([{
      permissions: [adminPermission],
      defaultScopes: [scope('owner', 'PRJ-1'), scope('owner', 'PRJ-2')],
      assignmentScopes: [scope('owner', 'PRJ-2')]
    }]), {
      current_user_project_admin_owner_project_codes: 'PRJ-2'
    })

    assert.deepEqual(aimsProjectListAdminScopeQueryFromGrants([{
      permissions: [adminPermission],
      defaultScopes: [scope('owner', 'PRJ-1')],
      assignmentScopes: [scope('owner', 'PRJ-2')]
    }]), {})
  })

  test('fails closed for mixed dimensions across L3 scope groups', () => {
    assert.deepEqual(aimsProjectListAdminScopeQueryFromGrants([{
      permissions: [adminPermission],
      defaultScopes: [{ dimension: 'department', predicate: 'self', value: 'D-1' }],
      assignmentScopes: [scope('member', 'PRJ-1')]
    }], { deptCodes: ['D-1'] }), {})
  })
})
