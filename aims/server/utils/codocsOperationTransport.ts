import { createError, getHeader, type H3Event } from 'h3'
import { serviceAppFetch } from '@hzy/foundation/server/utils/appServiceBinding'
import { localCodocsSchedulerHeaders, localUnifiedCompanySummaryCodocsHeaders } from './localCodocsSchedulerHeaders'
import type { requireTenantGatewaySchedulerRequest } from '@hzy/foundation/server/utils/tenantGatewayTrust'
import { resolveTrustedTenantGatewayContext } from '@hzy/foundation/server/utils/tenantGatewayTrust'
import { buildServiceCommandRuntimeHeaders, type SignedServiceCommandEnvelope } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { resolveServiceAppBaseUrl, resolveTrustedServiceAppRoute } from '@hzy/foundation/server/utils/serviceAppUrl'
import { requestWithServiceAccessToken, trustedServiceRequestHeaders } from '@hzy/foundation/server/utils/serviceOidc'
import type { ClaimedDeliveryOperation, RuntimeRow } from './serviceTicketDeliveryOperationExecutor'

interface RuntimeEnvelope<T> { code?: number | string, data?: T, message?: string }
type VerifiedScheduler = Awaited<ReturnType<typeof requireTenantGatewaySchedulerRequest>>
function text(value: unknown) {
  return String(value || '').trim()
}

function objectBody(value: unknown): RuntimeRow {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as RuntimeRow
  return {}
}

function appendPath(baseUrl: string, path: string) {
  const base = baseUrl.replace(/\/+$/, '')
  const normalized = path.replace(/^\/+/, '')
  if (base.endsWith('/api/v1') && normalized.startsWith('api/v1/')) {
    return `${base}/${normalized.slice('api/v1/'.length)}`
  }
  return `${base}/${normalized}`
}

function forwardedContextHeaders(event: H3Event, targetAppCode: 'codocs', idempotencyKey: string) {
  const headers = trustedServiceRequestHeaders(event, targetAppCode)
  const requestId = text(getHeader(event, 'x-request-id') || getHeader(event, 'x-correlation-id'))
  if (requestId) headers['x-request-id'] = requestId
  headers['idempotency-key'] = idempotencyKey
  return headers
}

export async function callCodocsOperationService(
  event: H3Event | null,
  envelope: RuntimeRow,
  idempotencyKey: string,
  periodKey: string,
  operation: ClaimedDeliveryOperation,
  targetDeploymentOverride = '',
  verifiedScheduler?: VerifiedScheduler
) {
  const productCreation = operation.operationCode === 'aims.codocs.product-document.create.v1'
  if (!productCreation && operation.operationCode !== 'aims.company-weekly-summary.codocs-publish.v1') throw createError({ statusCode: 409, message: 'Unsupported Codocs operation.' })
  const baseUrl = resolveServiceAppBaseUrl(event, 'codocs')
  if (!baseUrl) throw createError({ statusCode: 503, message: 'Codocs service API base URL is not configured.' })
  const url = appendPath(baseUrl, productCreation ? '/api/v1/service/product-documents/create' : `/api/v1/service/company-weekly-summaries/${encodeURIComponent(periodKey)}:publish`)
  const requestTarget = new URL(url, 'http://localhost').pathname
  const tenantCode = text(operation.tenantCode)
  const sourceDeploymentCode = text(operation.deploymentCode)
  const targetRoute = event ? resolveTrustedServiceAppRoute(event, 'codocs') : null
  const gateway = event ? resolveTrustedTenantGatewayContext(event) : null
  if (productCreation && event && (!gateway || !targetRoute)) throw createError({ statusCode: 503, message: 'Product document trusted route is unavailable.' })
  if (gateway && (
    !targetRoute
    || !['aims', 'enterprise'].includes(gateway.appCode)
    || text(gateway.tenant) !== tenantCode
    || text(gateway.deployment) !== sourceDeploymentCode
  )) {
    throw createError({ statusCode: 403, message: 'Codocs operation source route binding is invalid.' })
  }
  const targetDeploymentCode = text(
    targetRoute?.deploymentCode
    || targetDeploymentOverride
    || (event && !productCreation ? sourceDeploymentCode : '')
  )
  if (!tenantCode || !sourceDeploymentCode || !targetDeploymentCode) {
    throw createError({ statusCode: 503, message: 'Codocs operation deployment binding is unavailable.' })
  }
  const serviceCommand = objectBody(envelope.serviceCommand) as SignedServiceCommandEnvelope
  return await requestWithServiceAccessToken({
    audience: 'codocs',
    scope: productCreation ? 'codocs:product-document:create' : 'codocs:company-weekly-summary:publish',
    event,
    async request(token) {
      const requestId = text(event && (getHeader(event, 'x-request-id') || getHeader(event, 'x-correlation-id')))
        || crypto.randomUUID()
      const localHeaders = gateway?.appCode !== 'enterprise' && !productCreation
        ? event
          ? await localUnifiedCompanySummaryCodocsHeaders(verifiedScheduler, operation, requestTarget, targetDeploymentCode, requestId)
          : await localCodocsSchedulerHeaders(requestTarget, targetDeploymentCode, requestId)
        : {}
      const signedHeaders = await buildServiceCommandRuntimeHeaders({
        token,
        method: 'POST',
        requestTarget,
        requestId,
        tenantCode,
        sourceDeploymentCode,
        targetDeploymentCode,
        sourceApp: gateway?.appCode === 'enterprise' ? 'enterprise' : 'aims',
        sourceClientId: gateway?.appCode === 'enterprise' ? 'enterprise.runtime' : 'aims.runtime',
        targetApp: 'codocs',
        envelope: serviceCommand
      })
      const response = await serviceAppFetch<RuntimeEnvelope<RuntimeRow>>(
        event,
        'codocs',
        url,
        {
          method: 'POST',
          ...(!event ? { scheduledTargetDeployment: targetDeploymentCode } : {}),
          headers: {
            ...localHeaders,
            ...(event && Object.keys(localHeaders).length === 0
              ? forwardedContextHeaders(event, 'codocs', idempotencyKey)
              : {
                  'x-hzy-tenant': tenantCode,
                  'idempotency-key': idempotencyKey
                }),
            'x-request-id': requestId,
            ...signedHeaders,
            'authorization': `Bearer ${token}`,
            'content-type': 'application/json'
          },
          body: envelope,
          timeout: 15000
        }
      )
      if (response.code !== undefined && String(response.code) !== '0') {
        throw createError({ statusCode: 502, message: response.message || 'Codocs operation failed.' })
      }
      return objectBody(response.data)
    }
  })
}
