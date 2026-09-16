import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveServiceGrantPolicyBinding } from '../server/utils/serviceGrantPolicyBinding.ts'

test('service grant binding is derived from verified grant metadata', () => {
  assert.deepEqual(resolveServiceGrantPolicyBinding([
    { tenantCode: 'C000001', deploymentCode: 'C000001-console' },
    JSON.stringify({ tenantCode: 'C000001', deploymentCode: 'C000001-console' })
  ]), {
    tenantCode: 'C000001',
    deploymentCode: 'C000001-console'
  })
  assert.equal(resolveServiceGrantPolicyBinding([{ purpose: 'unbound' }, null]), null)
})

test('service grant binding fails closed on incomplete, malformed, or conflicting metadata', () => {
  assert.throws(
    () => resolveServiceGrantPolicyBinding([{ tenantCode: 'C000001' }]),
    /incomplete/
  )
  assert.throws(
    () => resolveServiceGrantPolicyBinding(['not-json']),
    /JSON/
  )
  assert.throws(
    () => resolveServiceGrantPolicyBinding([
      { tenantCode: 'C000001', deploymentCode: 'C000001-console' },
      { tenantCode: 'C000002', deploymentCode: 'C000002-console' }
    ]),
    /conflicting/
  )
})
