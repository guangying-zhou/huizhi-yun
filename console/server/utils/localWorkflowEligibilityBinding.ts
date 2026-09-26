import type { ConsoleRuntimeBinding } from './consoleRuntimeBinding'

// This narrows local Workflow service authorization: the signed token is
// bound to its loopback deployment while the Console policy still belongs to
// the Console deployment. The strict actor == selected binding check remains
// in each route's authorization gate.
export function localWorkflowServiceBinding(input: {
  binding: ConsoleRuntimeBinding
  actorAppCode: string | null | undefined
  actorDeploymentCode: string | null | undefined
  managed: boolean
  trustedGateway: boolean
  localFacade: boolean
  localWorkflow: boolean
  overrideDeployment: string | undefined
}): ConsoleRuntimeBinding | null {
  if (input.actorAppCode !== 'workflow' || !input.localFacade || !input.localWorkflow) return input.binding
  const local = input.managed && input.trustedGateway
    && input.binding.tenantId === 'C000001' && input.binding.deploymentId === 'wiztek-test-console'
    && input.overrideDeployment === 'C000001-test-workflow-local'
  if (!local) return null
  if (input.actorDeploymentCode !== input.overrideDeployment) return null
  return { tenantId: input.binding.tenantId, deploymentId: 'C000001-test-workflow-local' }
}

export const localWorkflowEligibilityBinding = localWorkflowServiceBinding
