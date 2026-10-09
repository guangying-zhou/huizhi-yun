import test from 'node:test'
import assert from 'node:assert/strict'
import { projectPeopleReadScope } from '../server/utils/peopleScopeProjection'

const required = { appCode: 'people', resourceCode: 'employees', action: 'view' }
function input(scopes: { dimension: string, predicate: string, value?: string }[]) {
  return { required, grants: [{ grantId: 'g', permissions: [required], scopes }] }
}
test('People scope compiles unique evaluator self, tree, global and no-grant truth tables', () => {
  const tree = [{ deptCode: 'A', children: [{ deptCode: 'B' }] }, { deptCode: 'C' }]
  assert.deepEqual(projectPeopleReadScope(input([{ dimension: 'subject', predicate: 'self' }]), 'Person', tree), { access: 'self', departmentCodes: [] })
  assert.deepEqual(projectPeopleReadScope(input([{ dimension: 'department', predicate: 'tree', value: 'A' }]), 'Person', tree), { access: 'dept', departmentCodes: ['A', 'B'] })
  assert.deepEqual(projectPeopleReadScope(input([{ dimension: 'tenant', predicate: 'global' }]), 'Person', tree), { access: 'all', departmentCodes: [] })
  assert.deepEqual(projectPeopleReadScope({ required, grants: [] }, 'Person', tree), { access: 'none', departmentCodes: [] })
  assert.equal(projectPeopleReadScope(input([{ dimension: 'project', predicate: 'member' }]), 'Person', tree), null)
  assert.equal(projectPeopleReadScope(input([]), 'Person', [{ deptCode: 'A' }, { deptCode: 'A' }]), null)
})
test('People scope fails closed rather than widen self AND department', () => {
  assert.equal(projectPeopleReadScope(input([{ dimension: 'subject', predicate: 'self' }, { dimension: 'department', predicate: 'self', value: 'A' }]), 'Person', [{ deptCode: 'A' }, { deptCode: 'B' }]), null)
})

test('People scope keeps role unions, action implication and assignment intersections in the unique evaluator', () => {
  const tree = [{ deptCode: 'A', children: [{ deptCode: 'B' }] }, { deptCode: 'C' }]
  const self = input([{ dimension: 'subject', predicate: 'self' }]).grants[0]!
  const dept = input([{ dimension: 'department', predicate: 'self', value: 'A' }]).grants[0]!
  assert.deepEqual(projectPeopleReadScope({ required, grants: [self, { ...dept, grantId: 'custom' }] }, 'Person', tree), { access: 'self_dept', departmentCodes: ['A'] })
  const admin = { ...dept, permissions: [{ ...required, action: 'admin' }] }
  assert.deepEqual(projectPeopleReadScope({ required, grants: [admin], policyOf: () => ({ implications: { admin: ['view'] } }) }, 'Person', tree), { access: 'dept', departmentCodes: ['A'] })
  assert.deepEqual(projectPeopleReadScope({ required, grants: [{ ...dept, permissions: [{ ...required, action: 'delete' }] }] }, 'Person', tree), { access: 'none', departmentCodes: [] })
  const bounded = { ...dept, scopes: [], defaultScopes: [{ dimension: 'department', predicate: 'tree', value: 'A' }], assignmentScopes: [{ dimension: 'department', predicate: 'self', value: 'B' }] }
  assert.deepEqual(projectPeopleReadScope({ required, grants: [bounded] }, 'Person', tree), { access: 'dept', departmentCodes: ['B'] })
})
