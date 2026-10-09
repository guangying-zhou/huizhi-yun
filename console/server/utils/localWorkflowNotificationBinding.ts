import type { H3Event } from 'h3'
import { resolveConsoleRuntimeBinding, type ConsoleRuntimeBinding } from './consoleRuntimeBinding'
import { isTrustedTenantGatewayRequest, loadConsoleRuntimeMode } from './platformRuntime'
import { localWorkflowServiceBinding } from './localWorkflowEligibilityBinding'

// Notification publish and actionable lifecycle share one publisher gate: in
// hzy0 in-app-only mode the local Workflow token carries its loopback
// deployment, everywhere else the Console binding is used unchanged.
export function resolveNotificationPublisherBinding(
  event: H3Event,
  actor: { appCode?: string | null, deploymentCode?: string | null }
): ConsoleRuntimeBinding | null {
  return localWorkflowServiceBinding({
    binding: resolveConsoleRuntimeBinding(event),
    actorAppCode: actor.appCode,
    actorDeploymentCode: actor.deploymentCode,
    managed: loadConsoleRuntimeMode(event).activationMode === 'managed-cloud-multitenant',
    trustedGateway: isTrustedTenantGatewayRequest(event),
    localFacade: process.env.HZY0_LOCAL_CONSOLE_FACADE === 'true',
    localWorkflow: process.env.HZY0_WORKFLOW_LOCAL_ONLY === 'true'
      && process.env.HZY0_NOTIFICATIONS_IN_APP_ONLY === 'true',
    overrideDeployment: process.env.HZY_CONSOLE_LOCAL_WORKFLOW_DEPLOYMENT
  })
}
