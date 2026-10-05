import { createError, type H3Event } from 'h3'
import { maybeCallTenantRuntime } from './tenantRuntimeClient'

// Registered system operations never carry a user or purpose delegation.
const systemOperations = Object.freeze({
  'aims.workflow-callback': { path: '/v1/aims/service/workflow/callback', domain: 'aims' },
  'aims.completion-callback': { path: '/v1/aims/service/work-item-completion/workflow-callback', domain: 'aims' }

} as const)
export async function callEnterpriseSystemRuntime<T>(event: H3Event, operation: keyof typeof systemOperations, body: Record<string, unknown>) {
  const route = systemOperations[operation]
  if (!route) throw createError({ statusCode: 503, message: 'System operation is not registered.' })
  const caller = event.context.consoleAuth
  if (!caller?.authenticated || caller.subjectType !== 'service' || caller.tokenUse !== 'service' || caller.appCode !== 'workflow' || caller.clientCode !== 'workflow.runtime' || !caller.scopes?.includes('enterprise:workflow-callback:execute')) throw createError({ statusCode: 403, message: 'A verified service caller is required.' })
  const response = await maybeCallTenantRuntime<T>(event, route.path, {
    channel: 'system', appCode: 'enterprise', scope: `${route.domain}:scheduler:execute`, capabilityFormat: 'business',
    serviceTokenSourceBinding: 'service-client-policy', method: 'POST', query: {}, body
  })
  if (!response.handled) throw createError({ statusCode: 503, message: 'Enterprise system runtime is unavailable.' })
  return response.data
}

// A separate, purpose-bound inspection lane. Never mixes with user or scheduler scope.
export async function callEnterpriseNotificationRuntime<T>(event: H3Event, domain: 'aims' | 'assets', viewer: { uid: string, tenantId: string, deploymentId: string }, body: Record<string, unknown>) {
  if (domain !== 'aims' && domain !== 'assets') throw createError({ statusCode: 403, message: 'Notification domain is not registered.' })
  const response = await maybeCallTenantRuntime<T>(event, `/v1/${domain}/notification-details/authorize`, {
    appCode: 'enterprise', scope: `${domain}:notification-detail:authorize`, capabilityFormat: 'business',
    serviceTokenSourceBinding: 'service-client-policy', method: 'POST', query: {}, body,
    notificationDetailActor: viewer, notificationDetailDomain: domain
  })
  if (!response.handled) throw createError({ statusCode: 503, message: 'Notification inspection runtime is unavailable.' })
  return response.data
}
