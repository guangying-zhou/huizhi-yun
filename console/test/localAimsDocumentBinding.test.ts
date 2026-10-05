import test from 'node:test'
import assert from 'node:assert/strict'
import { localAimsDocumentBinding } from '../server/utils/localAimsDocumentBinding.ts'

const valid = {
  binding: { tenantId: 'C000001', deploymentId: 'wiztek-test-console' },
  actorAppCode: 'aims', actorDeploymentCode: 'C000001-test-aims',
  managed: true, trustedGateway: true, localFacade: true, localWorkflow: true,
  overrideDeployment: 'C000001-test-aims'
}
test('local Aims documents preserve Console policy ownership and pin the signed caller', () => {
  assert.deepEqual(localAimsDocumentBinding(valid), { tenantId: 'C000001', deploymentId: 'C000001-test-aims' })
  for (const change of [
    { managed: false }, { trustedGateway: false }, { overrideDeployment: undefined },
    { overrideDeployment: 'other' }, { actorDeploymentCode: 'other' },
    { binding: { tenantId: 'C000002', deploymentId: 'wiztek-test-console' } },
    { binding: { tenantId: 'C000001', deploymentId: 'other' } }
  ]) assert.equal(localAimsDocumentBinding({ ...valid, ...change }), null)
  for (const change of [{ localFacade: false }, { localWorkflow: false }, { actorAppCode: 'workflow' }]) {
    assert.equal(localAimsDocumentBinding({ ...valid, ...change }), valid.binding)
  }
})
