import assert from 'node:assert/strict'
import test from 'node:test'
import {
  isManagedCloudProfile,
  isTenantRuntimeProfile,
  resolveDeploymentProfile
} from '../server/utils/deploymentProfile'

test('Console managed-cloud-runtime is a managed tenant-runtime profile', () => {
  const profile = resolveDeploymentProfile({
    hzy: {
      deploymentProfile: 'managed-cloud-runtime'
    }
  })

  assert.equal(profile, 'managed-cloud-runtime')
  assert.equal(isManagedCloudProfile(profile), true)
  assert.equal(isTenantRuntimeProfile(profile), true)
})

test('direct database and D1 profiles never opt into Tenant Runtime by default', () => {
  assert.equal(isTenantRuntimeProfile('managed-cloud-direct-db'), false)
  assert.equal(isTenantRuntimeProfile('managed-cloud-d1'), false)
})
