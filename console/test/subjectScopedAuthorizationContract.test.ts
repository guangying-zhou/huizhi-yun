import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveSubjectScopedAuthorizationRequest } from '../server/utils/subjectScopedAuthorizationContract.ts'

const binding = { tenantId: 'T', deploymentId: 'D' }
const actor = { actorType: 'service', actorId: 'client', appCode: 'assets', tenantCode: 'T', deploymentCode: 'D' }
const request = { subjectUid: 'U1', purpose: 'product_adoption_deliveries' }

test('subject scoped purposes fix resources and actions by caller', () => {
  for (const [app, purpose, resource, action] of [
    ['assets', 'product_adoption_deliveries', 'deliveries', 'view'],
    ['assets', 'product_adoption_environments', 'environments', 'view'],
    ['aims', 'product_feedback_create', 'product_requests', 'create'],
    ['aims', 'enterprise_project_document_write', 'projects', 'view'],
    ['aims', 'enterprise_project_document_read', 'projects', 'view'],
    ['aims', 'enterprise_project_document_access_policy_update', 'projects', 'view'],
    ['aims', 'enterprise_project_admin', 'projects', 'admin'],
    ['finance', 'product_cost_read', 'project_accounting', 'view'],
    ['finance', 'product_cost_rules_edit', 'project_accounting', 'edit']
  ]) {
    const result = resolveSubjectScopedAuthorizationRequest({ ...actor, appCode: app }, binding, { ...request, purpose })
    assert.equal(result.resourceCode, resource)
    assert.equal(result.action, action)
    assert.equal(result.subjectUid, 'U1')
  }
})

test('subject scoped requests reject identity and client-selected permission overrides', () => {
  for (const override of [{ actorType: 'user' }, { appCode: 'altoc' }, { tenantCode: 'OTHER' }, { deploymentCode: 'OTHER' }, { actorId: '' }]) {
    assert.throws(() => resolveSubjectScopedAuthorizationRequest({ ...actor, ...override }, binding, request), { statusCode: 403 })
  }
  for (const override of [{ resourceCode: 'products' }, { action: 'admin' }, { authorizationMode: 'role_simulation' }, { tenantId: 'OTHER' }, { subjectUid: '@all' }]) {
    assert.throws(() => resolveSubjectScopedAuthorizationRequest(actor, binding, { ...request, ...override }), { statusCode: 400 })
  }
  assert.throws(() => resolveSubjectScopedAuthorizationRequest(actor, binding, { ...request, purpose: 'product_feedback_create' }), { statusCode: 403 })
  assert.throws(() => resolveSubjectScopedAuthorizationRequest(actor, binding, { ...request, purpose: 'product_cost_read' }), { statusCode: 403 })
  assert.throws(() => resolveSubjectScopedAuthorizationRequest({ ...actor, appCode: 'finance' }, binding, { ...request, purpose: 'product_cost_write' }), { statusCode: 403 })
})
