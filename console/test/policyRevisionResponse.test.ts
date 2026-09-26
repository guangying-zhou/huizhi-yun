import assert from 'node:assert/strict'
import test from 'node:test'
import { parsePolicyRevisionResponse } from '../server/utils/policyRevisionResponse.ts'

const binding = { managed: true, tenant: 'C000001', environment: 'test', deployment: 'wiztek-test-console' }
const data = { tenant: binding.tenant, environment: binding.environment, deployment: binding.deployment,
  policyRevision: 27, payloadHash: 'sha256_current', status: 'active' }

test('managed Platform success envelope is accepted; Runtime code envelope remains independent', () => {
  assert.deepEqual(parsePolicyRevisionResponse({ success: true, data }, binding),
    { policyRevision: 27, payloadHash: 'sha256_current', status: 'active' })
  assert.equal(parsePolicyRevisionResponse({ code: 0, data }, binding), null)
  assert.deepEqual(parsePolicyRevisionResponse({ code: 0, data }, { ...binding, managed: false }),
    { policyRevision: 27, payloadHash: 'sha256_current', status: 'active' })
  assert.equal(parsePolicyRevisionResponse({ success: true, data }, { ...binding, managed: false }), null)
})

test('revision probe refuses wrong binding, unsuccessful envelope and malformed identity', () => {
  for (const response of [
    { success: false, data }, { data }, { success: true, data: { ...data, tenant: 'C000002' } },
    { success: true, data: { ...data, environment: 'prod' } },
    { success: true, data: { ...data, deployment: 'other' } },
    { success: true, data: { ...data, policyRevision: -1 } },
    { success: true, data: { ...data, payloadHash: '' } },
    { success: true, data: { ...data, status: 'unknown' } }
  ]) assert.equal(parsePolicyRevisionResponse(response, binding), null)
})
