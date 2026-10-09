import assert from 'node:assert/strict'
import test from 'node:test'
import {
  policyBundleDeploymentMatchesRuntime,
  policyBundleRequestQuery
} from '../server/utils/platformRuntimePolicyContextCore.ts'

test('managed Console policy bundle lookup is scoped by tenant environment, not caller deployment', () => {
  assert.deepEqual(policyBundleRequestQuery({
    activationMode: 'managed-cloud-multitenant',
    environment: 'prod',
    deploymentCode: 'C000001-assets'
  }), { environment: 'prod' })
})

test('managed Console accepts its canonical deployment bundle for a business-app request', () => {
  assert.equal(policyBundleDeploymentMatchesRuntime({
    activationMode: 'managed-cloud-multitenant',
    runtimeDeploymentCode: 'C000001-assets',
    bundleDeploymentCode: 'C000001-console'
  }), true)
})

test('standalone Console keeps exact deployment binding', () => {
  assert.deepEqual(policyBundleRequestQuery({
    activationMode: 'standalone',
    environment: 'prod',
    deploymentCode: 'C000001-console'
  }), {
    environment: 'prod',
    deploymentCode: 'C000001-console'
  })
  assert.equal(policyBundleDeploymentMatchesRuntime({
    activationMode: 'standalone',
    runtimeDeploymentCode: 'C000001-console',
    bundleDeploymentCode: 'C000001-assets'
  }), false)
})
