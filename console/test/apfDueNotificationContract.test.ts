import test from 'node:test'
import assert from 'node:assert/strict'
import { canonicalizePortalNotificationRequest } from '../server/utils/portalNotificationIdempotency'
import { notificationAuthorizationDescriptor, notificationDetailSourceAuthorizationTarget } from '../server/utils/notificationDetailContract'
import { resolveBoundSubjectEligibilityRequest, notificationDetailEligibilityTarget } from '../server/utils/subjectEligibilityContract'

test('APF eligibility binds actual Enterprise actor to fixed business policy tuples', () => {
  const actor = { actorType: 'service', actorId: 'enterprise.runtime', appCode: 'enterprise', tenantCode: 'C', deploymentCode: 'Host' }
  for (const [purpose, app, resource] of [['apf_sales_due', 'altoc', 'opportunity'], ['apf_sales_lead_due', 'altoc', 'lead'], ['apf_billing_due', 'altoc', 'receivable'], ['apf_issuance_due', 'finance', 'invoices'], ['apf_reconciliation_due', 'finance', 'receipts'], ['apf_handover_due', 'people', 'offboarding_tasks'], ['apf_asset_recovery_due', 'people', 'offboarding_tasks']]) {
    const result = resolveBoundSubjectEligibilityRequest(actor, { tenantId: 'C', deploymentId: 'Host' }, { subjectUid: 'Owner', purpose: purpose! })
    assert.equal(result.targetAppCode, app)
    assert.equal(result.resourceCode, resource)
    assert.equal(result.action, 'view')
    assert.deepEqual(notificationDetailEligibilityTarget('enterprise', purpose), { targetAppCode: app, resourceCode: resource, action: 'view' })
    for (const bad of [{ ...actor, actorId: 'other.runtime' }, { ...actor, appCode: app }, { ...actor, tenantCode: 'Other' }, { ...actor, deploymentCode: 'Other' }]) assert.throws(() => resolveBoundSubjectEligibilityRequest(bad, { tenantId: 'C', deploymentId: 'Host' }, { subjectUid: 'Owner', purpose: purpose! }))
  }
})
test('APF notifications retain actual Enterprise source and purpose-bound descriptor; old targets unchanged', () => {
  const key = 'apf-due:sales-due:lead:1:1'
  const row = { sourceAppCode: 'enterprise', bizType: 'apf_due_checkpoint', bizId: key, metadataJson: { notificationKind: 'apf_due', moduleAppCode: 'altoc', authorizationDescriptor: { resource: 'apf_sales_lead_due', id: key } } }
  assert.deepEqual(notificationAuthorizationDescriptor(row), { resource: 'apf_sales_lead_due', id: key })
  assert.equal(notificationAuthorizationDescriptor({ ...row, bizId: `${key}:fake` }), null)
  assert.equal(notificationAuthorizationDescriptor({ ...row, metadataJson: { ...row.metadataJson, authorizationDescriptor: { resource: 'apf_billing_due', id: key } } }), null)
  assert.deepEqual(notificationDetailSourceAuthorizationTarget('enterprise'), { audience: 'enterprise', scope: 'enterprise:notification-detail:authorize' })
  assert.deepEqual(notificationDetailSourceAuthorizationTarget('people'), { audience: 'people', scope: 'people:notification-details:authorize' })
  assert.throws(() => canonicalizePortalNotificationRequest({ sourceAppCode: 'people', title: '提醒', idempotencyKey: key, recipients: ['Owner'] }, { actorId: 'enterprise.runtime', appCode: 'enterprise' }))
})

test('dead-letter detail is a closed domain descriptor and retains current business permission', () => {
  const id = '90b90bf3-5899-4aed-98c8-23dd1897f463'
  for (const domain of ['altoc', 'finance', 'people']) {
    const resource = `apf_${domain}_dead_letter`
    const row = { sourceAppCode: 'enterprise', bizType: 'integration_operation', bizId: id, metadataJson: { notificationKind: 'apf_dead_letter', moduleAppCode: domain, authorizationDescriptor: { resource, id } } }
    assert.deepEqual(notificationAuthorizationDescriptor(row), { resource, id })
    assert.deepEqual(notificationDetailEligibilityTarget('enterprise', resource), { targetAppCode: domain, resourceCode: 'integration_operations', action: 'view' })
    assert.equal(notificationAuthorizationDescriptor({ ...row, bizId: 'wrong' }), null)
    assert.equal(notificationAuthorizationDescriptor({ ...row, metadataJson: { ...row.metadataJson, moduleAppCode: 'workflow' } }), null)
    assert.equal(notificationAuthorizationDescriptor({ ...row, metadataJson: { ...row.metadataJson, authorizationDescriptor: { resource, id, all: true } } }), null)
  }
})
