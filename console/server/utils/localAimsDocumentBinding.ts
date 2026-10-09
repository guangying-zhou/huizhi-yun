import type { ConsoleRuntimeBinding } from './consoleRuntimeBinding'

// The Console owns the verified policy; the Aims caller owns its service
// deployment. Only the pinned loopback stack may select that caller binding.
export function localAimsDocumentBinding(input: {
  binding: ConsoleRuntimeBinding
  actorAppCode: string | null | undefined
  actorDeploymentCode: string | null | undefined
  managed: boolean
  trustedGateway: boolean
  localFacade: boolean
  localWorkflow: boolean
  overrideDeployment: string | undefined
}): ConsoleRuntimeBinding | null {
  if (input.actorAppCode !== 'aims' || !input.localFacade || !input.localWorkflow) return input.binding
  if (!input.managed || !input.trustedGateway
    || input.binding.tenantId !== 'C000001' || input.binding.deploymentId !== 'wiztek-test-console'
    || input.overrideDeployment !== 'C000001-test-aims'
    || input.actorDeploymentCode !== input.overrideDeployment) return null
  return { tenantId: input.binding.tenantId, deploymentId: input.overrideDeployment }
}
