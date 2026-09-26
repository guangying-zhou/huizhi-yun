import { createError, type H3Event } from 'h3'
import { buildServiceCommandRuntimeHeaders, type SignedServiceCommandEnvelope } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { resolveServiceAppBaseUrl, resolveTrustedServiceAppRoute } from '@hzy/foundation/server/utils/serviceAppUrl'
import { resolveTrustedTenantGatewayContext } from '@hzy/foundation/server/utils/tenantGatewayTrust'
import { requestWithServiceAccessToken, trustedServiceRequestHeaders } from '@hzy/foundation/server/utils/serviceOidc'
import { serviceAppFetch } from '@hzy/foundation/server/utils/appServiceBinding'
import { cloudflareEnvFromEvent } from '@hzy/foundation/server/utils/consoleServiceBinding'
import type { ClaimedDeliveryOperation, RuntimeRow } from './serviceTicketDeliveryOperationExecutor'

export interface CompletionScheduledContext { cloudflare?: { env?: Record<string, unknown> }, _platform?: { cloudflare?: { env?: Record<string, unknown> } } }

export function assertLocalWorkflowCompletionTarget(base: string, localOnly = typeof process !== 'undefined' && process.env.HZY0_WORKFLOW_LOCAL_ONLY === 'true') {
  if (!localOnly) return
  let url: URL
  try {
    url = new URL(base)
  } catch {
    throw createError({ statusCode: 503, message: 'Local Workflow target is unavailable.' })
  }
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.port !== '23140' || url.pathname.replace(/\/+$/, '') !== '/workflow') {
    throw createError({ statusCode: 503, message: 'Local Workflow target is unavailable.' })
  }
}

export async function sendWorkItemCompletion(event: H3Event | null, operation: ClaimedDeliveryOperation, envelope: RuntimeRow, targetDeploymentOverride = '', taskContext?: CompletionScheduledContext): Promise<RuntimeRow> {
  const tenantCode = String(operation.tenantCode || '')
  const sourceDeploymentCode = String(operation.deploymentCode || '')
  const gateway = event ? resolveTrustedTenantGatewayContext(event) : null
  const route = event ? resolveTrustedServiceAppRoute(event, 'workflow') : null
  if (event && (!gateway || !route || gateway.tenant !== tenantCode || gateway.deployment !== sourceDeploymentCode || gateway.appCode !== 'aims')) {
    throw createError({ statusCode: 503, message: 'Completion trusted route is unavailable.' })
  }
  const targetDeploymentCode = route?.deploymentCode || targetDeploymentOverride
  const env = cloudflareEnvFromEvent({ context: taskContext || {} } as H3Event)
  const gatewayBinding = env.HZY_TENANT_GATEWAY_SERVICE as { fetch?: (url: string, init: RequestInit) => Promise<Response> } | undefined
  const gatewayOrigin = String(env.HZY_TENANT_GATEWAY_SERVICE_URL || '').trim()
  if (!event && (!gatewayBinding || typeof gatewayBinding.fetch !== 'function' || !/^https:\/\/[^/]+\/?$/.test(gatewayOrigin))) throw createError({ statusCode: 503, message: 'Completion scheduled Gateway binding is unavailable.' })
  const base = event ? resolveServiceAppBaseUrl(event, 'workflow') : `${gatewayOrigin.replace(/\/$/, '')}/workflow`
  assertLocalWorkflowCompletionTarget(base)
  if (!base || !tenantCode || !sourceDeploymentCode || !targetDeploymentCode) throw createError({ statusCode: 503, message: 'Completion deployment binding is unavailable.' })
  const url = `${base.replace(/\/+$/, '')}/api/v1/service/aims-work-item-completion-approval`
  // Carries only the actual platform environment for owned service credentials;
  // Gateway trust is created by the Gateway itself, never by this context.
  const credentialEvent = event || {
    context: { cloudflare: { env } },
    node: { req: { headers: {}, method: 'POST', url: '/__nitro/tasks/integration-operations:drain' }, res: {} }
  } as unknown as H3Event
  return await requestWithServiceAccessToken({ audience: 'workflow', scope: 'workflow:work-item-complete:create', event: credentialEvent, async request(token) {
    const requestId = crypto.randomUUID()
    const signed = await buildServiceCommandRuntimeHeaders({
      token, method: 'POST', requestTarget: new URL(url, 'http://localhost').pathname, requestId,
      tenantCode, sourceDeploymentCode, targetDeploymentCode, sourceApp: 'aims', sourceClientId: 'aims.runtime', targetApp: 'workflow',
      envelope: envelope.serviceCommand as SignedServiceCommandEnvelope
    })
    const options = {
      method: 'POST', body: envelope, timeout: 15000,
      headers: {
        // Request-driven delivery goes straight to Workflow, so carry only
        // the already verified Gateway context with the Workflow target bound.
        ...(event ? trustedServiceRequestHeaders(event, 'workflow') : {}),
        'x-hzy-tenant': tenantCode, 'x-hzy-deployment': targetDeploymentCode, 'x-hzy-app-code': 'workflow',
        'idempotency-key': String(operation.idempotencyKey), 'x-request-id': requestId,
        // The target verifies this actor against the frozen, signed command hash.
        'x-hzy-actor-uid': String(((envelope.serviceCommand as RuntimeRow)?.command as RuntimeRow)?.actorUid || ''),
        ...signed, 'authorization': `Bearer ${token}`, 'content-type': 'application/json'
      }
    } as const
    const response = event
      ? await serviceAppFetch<{ code: number, data: RuntimeRow }>(event, 'workflow', url, options)
      : await (async () => {
          const result = await gatewayBinding!.fetch!(url, { method: 'POST', headers: options.headers, body: JSON.stringify(envelope), signal: AbortSignal.timeout(15000) })
          const body = await result.json() as { code: number, data: RuntimeRow }
          if (!result.ok) throw createError({ statusCode: result.status, data: body, message: 'Completion Gateway request failed.' })
          return body
        })()
    if (response.code !== 0 || !response.data) throw createError({ statusCode: 502, message: 'Completion target response is invalid.' })
    return response.data
  } })
}
