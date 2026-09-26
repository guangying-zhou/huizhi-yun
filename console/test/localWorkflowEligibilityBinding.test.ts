import assert from 'node:assert/strict'
import test from 'node:test'
import { localWorkflowEligibilityBinding, localWorkflowServiceBinding } from '../server/utils/localWorkflowEligibilityBinding.ts'

const binding = { tenantId: 'C000001', deploymentId: 'wiztek-test-console' }
const local = { binding, actorAppCode: 'workflow', actorDeploymentCode: 'C000001-test-workflow-local',
  managed: true, trustedGateway: true, localFacade: true, localWorkflow: true,
  overrideDeployment: 'C000001-test-workflow-local' }

test('only a signed local Workflow source receives its exact extra binding', () => {
  assert.deepEqual(localWorkflowEligibilityBinding(local),
    { tenantId: 'C000001', deploymentId: 'C000001-test-workflow-local' })
  for (const changed of [
    { localFacade: false }, { localWorkflow: false }
  ]) assert.deepEqual(localWorkflowEligibilityBinding({ ...local, ...changed }), binding)
  for (const changed of [
    { managed: false }, { trustedGateway: false },
    { overrideDeployment: undefined }, { overrideDeployment: 'other' },
    { binding: { ...binding, tenantId: 'C000002' } },
    { binding: { ...binding, deploymentId: 'other-console' } }
  ]) assert.equal(localWorkflowEligibilityBinding({ ...local, ...changed }), null)
})

test('wrong Workflow deployment is rejected while unrelated app bindings stay unchanged', () => {
  for (const actorDeploymentCode of ['wiztek-test-console', 'C000001-test-workflow', null, 'other']) {
    assert.equal(localWorkflowEligibilityBinding({ ...local, actorDeploymentCode }), null)
  }
  assert.deepEqual(localWorkflowEligibilityBinding({ ...local, actorAppCode: 'aims' }), binding)
})

test('notification publisher reuses the same exact local binding without weakening the Console default', () => {
  assert.equal(localWorkflowEligibilityBinding, localWorkflowServiceBinding)
  assert.deepEqual(localWorkflowServiceBinding(local), { tenantId: 'C000001', deploymentId: 'C000001-test-workflow-local' })
  assert.equal(localWorkflowServiceBinding({ ...local, trustedGateway: false }), null)
})
