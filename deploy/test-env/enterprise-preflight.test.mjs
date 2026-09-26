import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { auditEnterpriseTemplate } from './enterprise-preflight.mjs'
const fixture = () => JSON.parse(readFileSync(new URL('./enterprise-readiness.template.json', import.meta.url)))
test('checked template tracks real Host operations and never implies live readiness', () => {
  const result = auditEnterpriseTemplate(fixture())
  assert.deepEqual(result.errors, [])
  assert.equal(result.templateValid, true)
  assert.equal(result.deploymentReady, false)
  assert.ok(result.pending.includes('RELEASE_ARTIFACTS_MISSING'))
  assert.ok(result.pending.includes('EVIDENCE_MISSING_assetsOwnedReceiptSchema'))
  assert.ok(result.pending.includes('EVIDENCE_MISSING_assetsProductLinkReceiptSchema'))
  assert.deepEqual(result.sourceMigrationOrder, ['assets/docs/migrations/20260913_assets_owned_product_receipts.sql', 'assets/docs/migrations/20260914_assets_owned_product_link_receipts.sql'])
  assert.deepEqual(result.migrationOrder.slice(-3), ['20260913-enterprise-recovery-route.sql', '20260913-enterprise-external-drain-approval.sql', '20260914-enterprise-drain-activity-approval.sql'])
})
test('rejects legacy memory, borrowed identity, wildcard grants and secret values without disclosure', () => {
  const value = fixture()
  value.console.policyBundleCacheBackend = 'memory'
  value.servicePolicy.clientCode = 'aims.runtime'
  value.servicePolicy.capabilities.push('aims:*:*')
  value.runtime.password = 'never-echo-this'
  const result = auditEnterpriseTemplate(value)
  assert.ok(result.errors.includes('PERSISTENT_POLICY_REQUIRED'))
  assert.ok(result.errors.includes('SERVICE_IDENTITY_MISMATCH'))
  assert.ok(result.errors.includes('EXACT_CAPABILITY_DRIFT'))
  assert.ok(result.errors.includes('SECRET_FIELD_FORBIDDEN'))
  assert.ok(!JSON.stringify(result).includes('never-echo-this'))
})
test('rejects unsafe origin, inconsistent owner and unknown artifact without echoing paths', () => {
  const value = fixture()
  value.host.origin = 'https://user:password@example.invalid/'
  value.host.deploymentCode = 'host'
  value.runtime.domains.aims.ownerDeployment = 'other-host'
  value.artifacts = Object.fromEntries(Object.keys(value.artifacts).map(key => [key, '/missing-sensitive-path']))
  const result = auditEnterpriseTemplate(value)
  assert.ok(result.errors.includes('HOST_ORIGIN_INVALID'))
  assert.ok(result.errors.includes('DOMAIN_OWNER_MISMATCH'))
  assert.ok(result.errors.includes('ARTIFACT_READ_FAILED'))
  assert.ok(!JSON.stringify(result).includes('missing-sensitive'))
})
test('evidence labels cannot make static configuration deployment ready', () => {
  const value = fixture()
  for (const key of Object.keys(value.evidence)) value.evidence[key] = 'review-reference'
  const result = auditEnterpriseTemplate(value)
  assert.equal(result.deploymentReady, false)
  assert.equal(result.requiredExternalReview, true)
})

test('unified scheduler requires a separate real worker and complete outbox mapping', () => {
  const value = fixture()
  value.host.deploymentCode = 'enterprise-test'
  const aims = value.runtime.domains.aims
  aims.scheduler = 'unified'
  aims.write = 'unified'
  aims.tables = Object.fromEntries(['integration_operation', 'integration_operation_attempt', 'service_command_receipt', 'integration_operation_dead_letter_actionable'].map(name => [name, `u_${name}`]))
  value.runtime.aimsDeliveryWorker = { serviceClientId: 'aims.runtime', deployment: 'aims-test' }
  value.runtime.deploymentBindings = { aims: 'aims-test' }
  let result = auditEnterpriseTemplate(value)
  assert.deepEqual(result.errors, [])
  assert.equal(result.deploymentReady, false)
  assert.ok(result.pending.includes('EVIDENCE_MISSING_schedulerTenantSelectionAndDrain'))
  value.runtime.aimsDeliveryWorker.deployment = 'enterprise-test'
  aims.tables.service_command_receipt = aims.tables.integration_operation
  result = auditEnterpriseTemplate(value)
  assert.ok(result.errors.includes('SCHEDULER_WORKER_BINDING_MISMATCH'))
  assert.ok(result.errors.includes('SCHEDULER_OUTBOX_MAPPING_REQUIRED'))
})

test('pilot issuance requires actual data-runtime audience only',()=>{
 const input=JSON.parse(readFileSync(new URL('./enterprise-readiness.template.json',import.meta.url)))
 input.servicePolicy.audiences=['data-runtime','tenant-runtime']
 assert.ok(auditEnterpriseTemplate(input).errors.includes('AUDIENCE_MATRIX_REQUIRED'))
})

test('external service grants match the real document transport and stay outside Runtime', () => {
  for (const replacement of [undefined, [], [{ audience: 'data-runtime', capabilities: ['codocs:product-document:read'] }], [{ audience: 'codocs', capabilities: ['codocs:product-document:create'] }]]) {
    const input = fixture()
    input.externalServicePolicies = replacement
    assert.ok(auditEnterpriseTemplate(input).errors.includes('EXTERNAL_SERVICE_POLICY_DRIFT'))
  }
  const input = fixture()
  input.servicePolicy.capabilities.push('codocs:product-document:read')
  assert.ok(auditEnterpriseTemplate(input).errors.includes('EXACT_CAPABILITY_DRIFT'))
  assert.ok(auditEnterpriseTemplate(fixture()).pending.includes('EVIDENCE_MISSING_externalServiceExactGrants'))
})
