import { requireTenantGatewaySchedulerRequest } from './tenantGatewayTrust'
import { createError, type H3Event } from 'h3'
import { maybeCallTenantRuntime } from './tenantRuntimeClient'

// Registered system operations never carry a user or purpose delegation.
const systemOperations = Object.freeze({
  'finance.approval-callback': { path: '/v1/enterprise/finance/invoice-approval:callback', domain: 'finance' },
  'people.workflow-callback': { path: '/v1/enterprise/people/workflow:callback', domain: 'people' },
  'altoc.approval-callback': { path: '/v1/enterprise/altoc/approval:callback', domain: 'altoc' },
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
export async function callEnterpriseNotificationRuntime<T>(event: H3Event, domain: 'aims' | 'assets' | 'altoc' | 'finance' | 'people', viewer: { uid: string, tenantId: string, deploymentId: string }, body: Record<string, unknown>) {
  if (!['aims', 'assets', 'altoc', 'finance', 'people'].includes(domain)) throw createError({ statusCode: 403, message: 'Notification domain is not registered.' })
  const response = await maybeCallTenantRuntime<T>(event, `/v1/${domain}/notification-details/authorize`, {
    appCode: 'enterprise', scope: `${domain}:notification-detail:authorize`, capabilityFormat: 'business',
    serviceTokenSourceBinding: 'service-client-policy', method: 'POST', query: {}, body,
    notificationDetailActor: viewer, notificationDetailDomain: domain
  })
  if (!response.handled) throw createError({ statusCode: 503, message: 'Notification inspection runtime is unavailable.' })
  return response.data
}

// APF's bounded machine sample has its own signed wake path. No dispatcher,
// public cron registration or Gateway owner is enabled by defining this helper.
export async function callEnterpriseAPFScheduler(event: H3Event, domain: 'altoc' | 'finance' | 'people') {
  if (!['altoc', 'finance', 'people'].includes(domain)) throw createError({ statusCode: 403 })
  const wake = await requireAPFWake(event, domain)
  const response = await maybeCallTenantRuntime(event, `/v1/enterprise/${domain}/scheduler:inspect`, {
    appCode: 'enterprise', scope: `${domain}:scheduler:execute`, capabilityFormat: 'business',
    serviceTokenSourceBinding: 'service-client-policy', method: 'POST', timeoutMs: 3000, channel: 'system',
    enterpriseScheduler: { generation: wake.schedulerGeneration }, body: {}, query: {}
  })
  if (!response.handled) throw createError({ statusCode: 503 })
  return response.data
}

// Only the existing signed APF wake can resume frozen Altoc intents.
export async function callEnterpriseAltocApprovalWorker<T>(event: H3Event, operation: 'pending' | 'bind', body: Record<string, unknown>) {
  const wake = await requireAPFWake(event, 'altoc')
  const response = await maybeCallTenantRuntime<T>(event, `/v1/enterprise/altoc/approval:${operation}`, {
    appCode: 'enterprise', scope: 'altoc:scheduler:execute', capabilityFormat: 'business',
    serviceTokenSourceBinding: 'service-client-policy', method: 'POST', timeoutMs: 3000, channel: 'system',
    enterpriseScheduler: { generation: wake.schedulerGeneration }, body, query: {}
  })
  if (!response.handled) throw createError({ statusCode: 503 })
  return response.data
}

// Same authenticated APF wake as the existing scheduler sample. It never accepts
// browser actor facts, nor enables a new cron or owner by defining this helper.
export async function callEnterprisePeopleDirectoryWorker<T>(event: H3Event, operation: 'prepare-due' | 'claim' | 'ack' | 'fail', body: Record<string, unknown>) {
  if (!['prepare-due', 'claim', 'ack', 'fail'].includes(operation)) throw createError({ statusCode: 403 })
  const wake = await requireAPFWake(event, 'people')
  const response = await maybeCallTenantRuntime<T>(event, `/v1/enterprise/people/directory-lifecycle:${operation}`, {
    appCode: 'enterprise', scope: 'people:scheduler:execute', capabilityFormat: 'business',
    serviceTokenSourceBinding: 'service-client-policy', method: 'POST', timeoutMs: 3000, channel: 'system',
    enterpriseScheduler: { generation: wake.schedulerGeneration }, body, query: {}
  })
  if (!response.handled) throw createError({ statusCode: 503 })
  return response.data
}

// Only the existing signed APF wake resumes immutable Finance invoice intents.
export async function callEnterpriseFinanceApprovalWorker<T>(event: H3Event, operation: 'pending' | 'bind', body: Record<string, unknown>) {
  if (!['pending', 'bind'].includes(operation)) throw createError({ statusCode: 403 })
  const wake = await requireAPFWake(event, 'finance')
  const response = await maybeCallTenantRuntime<T>(event, `/v1/enterprise/finance/invoice-approval:${operation === 'bind' ? 'bind-system' : 'pending'}`, {
    appCode: 'enterprise', scope: 'finance:scheduler:execute', capabilityFormat: 'business', serviceTokenSourceBinding: 'service-client-policy',
    method: 'POST', timeoutMs: 3000, channel: 'system', enterpriseScheduler: { generation: wake.schedulerGeneration }, body, query: {}
  })
  if (!response.handled) throw createError({ statusCode: 503 })
  return response.data
}

async function requireAPFWake(event: H3Event, domain: 'altoc' | 'finance' | 'people') {
  const runtime = event as H3Event & { req?: { runtime?: { cloudflare?: { env?: Record<string, unknown> } } } }
  const env = runtime.context?.cloudflare?.env || runtime.context?._platform?.cloudflare?.env || runtime.req?.runtime?.cloudflare?.env
  const enabled = env?.HZY_ENTERPRISE_APF_SCHEDULER_ENABLED ?? process.env.HZY_ENTERPRISE_APF_SCHEDULER_ENABLED
  if (enabled !== 'true') throw createError({ statusCode: 503, statusMessage: 'apf_scheduler_disabled' })
  const wake = await requireTenantGatewaySchedulerRequest(event, 'enterprise', '/enterprise/api/internal/apf/scheduler-inspect')
  if (wake.apfDomain !== domain || wake.schedulerStorage !== 'unified' || !wake.schedulerGeneration) throw createError({ statusCode: 403 })
  return wake
}
export async function callEnterprisePeopleApprovalWorker<T>(event: H3Event, operation: 'pending' | 'bind', body: Record<string, unknown>) {
  if (!['pending', 'bind'].includes(operation)) throw createError({ statusCode: 403 })
  const wake = await requireAPFWake(event, 'people')
  const response = await maybeCallTenantRuntime<T>(event, `/v1/enterprise/people/assignment-approval:${operation}`, {
    appCode: 'enterprise', scope: 'people:scheduler:execute', capabilityFormat: 'business', serviceTokenSourceBinding: 'service-client-policy',
    method: 'POST', timeoutMs: 3000, channel: 'system', enterpriseScheduler: { generation: wake.schedulerGeneration }, body, query: {}
  })
  if (!response.handled) throw createError({ statusCode: 503 })
  return response.data
}

// The existing Aims owner retains both legacy exact commands. No inbound token
// is forwarded: this target hop obtains Enterprise's own exact S identity.
export async function callEnterpriseAltocFeedbackProjection<T>(event: H3Event, kind: 'status' | 'progress', body: Record<string, unknown>) {
  if (!['status', 'progress'].includes(kind)) throw createError({ statusCode: 403 })
  const caller = event.context.consoleAuth
  if (!caller?.authenticated || caller.subjectType !== 'service' || caller.tokenUse !== 'service' || caller.appCode !== 'aims' || caller.clientCode !== 'aims.runtime' || !caller.scopes?.includes(`altoc:product-feedback:update-${kind}`)) throw createError({ statusCode: 403 })
  const response = await maybeCallTenantRuntime<T>(event, `/v1/enterprise/altoc/product-feedback-${kind}`, {
    channel: 'system', appCode: 'enterprise', scope: 'altoc:scheduler:execute', capabilityFormat: 'business', serviceTokenSourceBinding: 'service-client-policy', method: 'POST', query: {}, body
  })
  if (!response.handled) throw createError({ statusCode: 503 })
  return response.data
}

const dueDomains = Object.freeze({ 'sales-due': 'altoc', 'billing-due': 'altoc', 'issuance-due': 'finance', 'reconciliation-due': 'finance', 'handover-due': 'people', 'asset-recovery-due': 'people' } as const)
export type APFDueFamily = keyof typeof dueDomains
/** Fixed S commands, independent of any actor/permit. Reuses the authenticated APF wake. */
export async function callEnterpriseAPFDueWorker<T>(event: H3Event, family: APFDueFamily, operation: 'scan-due' | 'published' | 'closure-ack', body: Record<string, unknown>) {
  if (!Object.hasOwn(dueDomains, family) || !['scan-due', 'published', 'closure-ack'].includes(operation)) throw createError({ statusCode: 403 })
  const domain = dueDomains[family]
  const wake = await requireAPFWake(event, domain)
  const response = await maybeCallTenantRuntime<T>(event, `/v1/enterprise/${domain}/${family}:${operation}`, {
    appCode: 'enterprise', scope: `${domain}:scheduler:execute`, capabilityFormat: 'business', serviceTokenSourceBinding: 'service-client-policy',
    method: 'POST', timeoutMs: 3000, channel: 'system', enterpriseScheduler: { generation: wake.schedulerGeneration }, body, query: {}
  })
  if (!response.handled) throw createError({ statusCode: 503 })
  return response.data
}

export type APFDeadLetterOperation = 'pending-dead-letter-actionables' | 'dead-letter-actionable-published' | 'pending-dead-letter-closures' | 'dead-letter-closure-acknowledged'
/** Same signed wake and precise S scope; never the user U channel. */
export async function callEnterpriseAPFDeadLetterWorker<T>(event: H3Event, domain: 'altoc' | 'finance' | 'people', operation: APFDeadLetterOperation, body: Record<string, unknown>) {
  if (!['altoc', 'finance', 'people'].includes(domain) || !['pending-dead-letter-actionables', 'dead-letter-actionable-published', 'pending-dead-letter-closures', 'dead-letter-closure-acknowledged'].includes(operation)) throw createError({ statusCode: 403 })
  const wake = await requireAPFWake(event, domain)
  const response = await maybeCallTenantRuntime<T>(event, `/v1/enterprise/${domain}/${operation}`, {
    appCode: 'enterprise', scope: `${domain}:scheduler:execute`, capabilityFormat: 'business', serviceTokenSourceBinding: 'service-client-policy',
    method: 'POST', timeoutMs: 3000, channel: 'system', enterpriseScheduler: { generation: wake.schedulerGeneration }, body, query: {}
  })
  if (!response.handled) throw createError({ statusCode: 503 })
  return response.data
}
