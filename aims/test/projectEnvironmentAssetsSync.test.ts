import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  projectEnvironmentDeploymentStatus,
  projectEnvironmentLifecycleStatus
} from '../server/utils/projectEnvironmentAssetsSyncMapping.ts'

describe('project environment Assets sync status mapping', () => {
  test('maps Aims delivery status to Assets deployment status', () => {
    assert.equal(projectEnvironmentDeploymentStatus('planned'), 'planned')
    assert.equal(projectEnvironmentDeploymentStatus('provisioning'), 'provisioning')
    assert.equal(projectEnvironmentDeploymentStatus('deployed'), 'deployed')
    assert.equal(projectEnvironmentDeploymentStatus('online'), 'online')
    assert.equal(projectEnvironmentDeploymentStatus('accepted'), 'accepted')
    assert.equal(projectEnvironmentDeploymentStatus('handed_over'), 'accepted')
    assert.equal(projectEnvironmentDeploymentStatus('suspended'), 'suspended')
    assert.equal(projectEnvironmentDeploymentStatus('cancelled'), 'removed')
  })

  test('only pushes long-lived environment lifecycle transitions when needed', () => {
    assert.equal(projectEnvironmentLifecycleStatus('planned'), '')
    assert.equal(projectEnvironmentLifecycleStatus('deployed'), '')
    assert.equal(projectEnvironmentLifecycleStatus('online'), 'active')
    assert.equal(projectEnvironmentLifecycleStatus('accepted'), 'accepted')
    assert.equal(projectEnvironmentLifecycleStatus('handed_over'), 'accepted')
    assert.equal(projectEnvironmentLifecycleStatus('suspended'), 'frozen')
  })
})
