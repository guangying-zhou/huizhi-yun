import assert from 'node:assert/strict'
import { test } from 'node:test'
import { enterpriseProjectDocumentWriteScopeAllows } from '../server/utils/enterpriseProjectDocumentScope'

const permission = { appCode: 'aims', resourceCode: 'projects', action: 'edit' }
function subject(scopes: Array<{ dimension: string, predicate: string, value?: string }>, action = 'edit') {
  return {
    uid: 'actor', appCode: 'aims', purpose: 'enterprise_project_document_write', resourceCode: 'projects', action,
    authorizationMode: 'merged' as const, policyRevision: 1, bundleVersion: 'v1', departmentCodes: [],
    departmentTree: { D1: ['D1', 'D2'], D2: ['D2'] },
    grants: [{ grantId: 'g1', permissions: [permission], scopes }]
  }
}
const project = { actorUid: 'actor', projectCode: 'P1', departmentCode: 'D2', projectMemberUids: ['actor'], projectOwnerUid: 'other', ownerUid: 'other' }

test('project document writes require the current project in the edit grant scope', () => {
  assert.equal(enterpriseProjectDocumentWriteScopeAllows(subject([{ dimension: 'project', predicate: 'code', value: 'P1' }]), project), true)
  assert.equal(enterpriseProjectDocumentWriteScopeAllows(subject([{ dimension: 'project', predicate: 'code', value: 'P2' }]), project), false)
  assert.equal(enterpriseProjectDocumentWriteScopeAllows(subject([{ dimension: 'project', predicate: 'member' }]), project), true)
  assert.equal(enterpriseProjectDocumentWriteScopeAllows(subject([{ dimension: 'project', predicate: 'member' }]), { ...project, projectMemberUids: [] }), false)
})

test('tree facts come only from Console and an unsupported predicate cannot widen access', () => {
  assert.equal(enterpriseProjectDocumentWriteScopeAllows(subject([{ dimension: 'department', predicate: 'tree', value: 'D1' }]), project), true)
  assert.equal(enterpriseProjectDocumentWriteScopeAllows({ ...subject([{ dimension: 'department', predicate: 'tree', value: 'D1' }]), departmentTree: {} }, project), false)
  assert.equal(enterpriseProjectDocumentWriteScopeAllows(subject([{ dimension: 'unknown', predicate: 'all', value: 'P1' }]), project), false)
})

test('a view-only grant cannot authorize project document writes', () => {
  const view = { ...subject([]), grants: [{ grantId: 'g1', permissions: [{ ...permission, action: 'view' }], scopes: [] }] }
  assert.equal(enterpriseProjectDocumentWriteScopeAllows(view, project), false)
})
