import { sendProductFeedbackProgress } from './productFeedbackProgressTransport'
import { sendProductCostRules } from './productCostRulesTransport'
import { sendProductFeedbackStatus } from './productFeedbackStatusTransport'
import { createError, getHeader, type H3Event } from 'h3'
import { serviceAppFetch } from '@hzy/foundation/server/utils/appServiceBinding'
import {
  buildServiceCommandRuntimeHeaders,
  maybeCallTenantRuntime,
  type SignedServiceCommandEnvelope
} from '@hzy/foundation/server/utils/tenantRuntimeClient'
import {
  resolveServiceAppBaseUrl,
  resolveTrustedServiceAppRoute
} from '@hzy/foundation/server/utils/serviceAppUrl'
import { requestWithServiceAccessToken, trustedServiceRequestHeaders } from '@hzy/foundation/server/utils/serviceOidc'
import { resolveTrustedTenantGatewayContext } from '@hzy/foundation/server/utils/tenantGatewayTrust'
import {
  executeClaimedServiceTicketDeliveryOperation,
  type ClaimedDeliveryOperation,
  type RuntimeRow,
  type ServiceTicketDeliveryOperationIO
} from './serviceTicketDeliveryOperationExecutor'
import { executeClaimedMilestoneReceivableOperation } from './milestoneReceivableOperationExecutor'
import { executeClaimedCompanyWeeklySummaryOperation } from './companyWeeklySummaryOperationExecutor'

interface RuntimeEnvelope<T> {
  code?: number | string
  data?: T
  message?: string
}

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

function forwardedContextHeaders(event: H3Event, targetAppCode: string, idempotencyKey: string) {
  const headers = trustedServiceRequestHeaders(event, targetAppCode)
  const requestId = text(getHeader(event, 'x-request-id') || getHeader(event, 'x-correlation-id'))
  if (requestId) headers['x-request-id'] = requestId
  headers['idempotency-key'] = idempotencyKey
  return headers
}

async function callAimsOperationRuntime<T>(event: H3Event, path: string, body: RuntimeRow) {
  const runtime = await maybeCallTenantRuntime<RuntimeEnvelope<T>>(event, path, {
    appCode: 'aims',
    scope: 'aims.write aims:integration_operation:execute',
    method: 'POST',
    body
  })
  if (!runtime.handled) {
    throw createError({ statusCode: 503, message: 'Aims tenant-runtime is required for reliable delivery.' })
  }
  if (runtime.data.code !== undefined && String(runtime.data.code) !== '0') {
    throw createError({ statusCode: 502, message: runtime.data.message || 'Aims integration operation failed.' })
  }
  return runtime.data.data as T
}

async function callAltocDeliveryService(event: H3Event | null, envelope: RuntimeRow, idempotencyKey: string) {
  const baseUrl = resolveServiceAppBaseUrl(event, 'altoc')
  if (!baseUrl) {
    throw createError({ statusCode: 503, message: 'Altoc service API base URL is not configured.' })
  }
  return await requestWithServiceAccessToken({
    audience: 'altoc',
    scope: 'altoc:service-ticket:delivery-result:sync',
    event,
    async request(token) {
      const command = objectBody(objectBody(envelope.serviceCommand).command)
      const ticketCode = text(command.ticketCode)
      const response = await serviceAppFetch<RuntimeEnvelope<RuntimeRow>>(
        event,
        'altoc',
        appendPath(baseUrl, `/api/v1/service/service-tickets/${encodeURIComponent(ticketCode)}/delivery-result:sync`),
        {
          method: 'POST',
          headers: {
            ...(event ? forwardedContextHeaders(event, 'altoc', idempotencyKey) : { 'idempotency-key': idempotencyKey }),
            'authorization': `Bearer ${token}`,
            'content-type': 'application/json'
          },
          body: envelope,
          timeout: 10000
        }
      )
      if (response.code !== undefined && String(response.code) !== '0') {
        throw createError({ statusCode: 502, message: response.message || 'Altoc service ticket delivery sync failed.' })
      }
      return objectBody(response.data)
    }
  })
}

async function callAltocReceivableService(event: H3Event | null, envelope: RuntimeRow, idempotencyKey: string) {
  const baseUrl = resolveServiceAppBaseUrl(event, 'altoc')
  if (!baseUrl) {
    throw createError({ statusCode: 503, message: 'Altoc service API base URL is not configured.' })
  }
  const command = objectBody(objectBody(envelope.serviceCommand).command)
  const paymentTermId = text(command.paymentTermId)
  if (!/^[1-9][0-9]*$/.test(paymentTermId)) {
    throw createError({ statusCode: 409, statusMessage: 'integration_operation_identity_mismatch', message: 'Frozen payment term target is invalid.' })
  }
  return await requestWithServiceAccessToken({
    audience: 'altoc',
    scope: 'altoc:receivable:mark-billable',
    event,
    async request(token) {
      const response = await serviceAppFetch<RuntimeEnvelope<RuntimeRow>>(
        event,
        'altoc',
        appendPath(baseUrl, `/api/v1/service/payment-terms/${encodeURIComponent(paymentTermId)}/receivable-plan:mark-billable`),
        {
          method: 'POST',
          headers: {
            ...(event ? forwardedContextHeaders(event, 'altoc', idempotencyKey) : { 'idempotency-key': idempotencyKey }),
            'authorization': `Bearer ${token}`,
            'content-type': 'application/json'
          },
          body: envelope,
          timeout: 10000
        }
      )
      if (response.code !== undefined && String(response.code) !== '0') {
        throw createError({ statusCode: 502, message: response.message || 'Altoc receivable billable command failed.' })
      }
      return objectBody(response.data)
    }
  })
}

async function callPeopleContributionService(event: H3Event | null, envelope: RuntimeRow, idempotencyKey: string) {
  const baseUrl = resolveServiceAppBaseUrl(event, 'people')
  if (!baseUrl) throw createError({ statusCode: 503, message: 'People service API base URL is not configured.' })
  return await requestWithServiceAccessToken({ audience: 'people', scope: 'people:write', event, async request(token) {
    const response = await serviceAppFetch<RuntimeEnvelope<RuntimeRow>>(
      event,
      'people',
      appendPath(baseUrl, '/api/v1/service/contributions:sync'),
      {
        method: 'POST',
        headers: {
          ...(event ? forwardedContextHeaders(event, 'people', idempotencyKey) : { 'idempotency-key': idempotencyKey }),
          'authorization': `Bearer ${token}`,
          'content-type': 'application/json'
        },
        body: envelope,
        timeout: 10000
      }
    )
    if (response.code !== undefined && String(response.code) !== '0') throw createError({ statusCode: 502, message: response.message || 'People contribution sync failed.' })
    return objectBody(response.data)
  } })
}

async function callCodocsOperationService(
  event: H3Event | null,
  envelope: RuntimeRow,
  idempotencyKey: string,
  periodKey: string,
  operation: ClaimedDeliveryOperation,
  targetDeploymentOverride = ''
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
      const signedHeaders = await buildServiceCommandRuntimeHeaders({
        token,
        method: 'POST',
        requestTarget,
        requestId,
        tenantCode,
        sourceDeploymentCode,
        targetDeploymentCode,
        sourceApp: 'aims',
        sourceClientId: 'aims.runtime',
        targetApp: 'codocs',
        envelope: serviceCommand
      })
      const response = await serviceAppFetch<RuntimeEnvelope<RuntimeRow>>(
        event,
        'codocs',
        url,
        {
          method: 'POST',
          headers: {
            ...(event
              ? forwardedContextHeaders(event, 'codocs', idempotencyKey)
              : {
                  'x-hzy-tenant': tenantCode,
                  'x-hzy-deployment': targetDeploymentCode,
                  'x-hzy-app-code': 'codocs',
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

export function createRequestServiceTicketDeliveryOperationIO(event: H3Event): ServiceTicketDeliveryOperationIO {
  return {
    callRuntime: <T>(path: string, body: RuntimeRow) => callAimsOperationRuntime<T>(event, path, body),
    callAltoc: (command, idempotencyKey) => callAltocDeliveryService(event, command, idempotencyKey),
    callAltocReceivable: (command, idempotencyKey) => callAltocReceivableService(event, command, idempotencyKey),
    callPeople: (command, idempotencyKey) => callPeopleContributionService(event, command, idempotencyKey),
    callFinanceProductCostRules: (command, operation) => sendProductCostRules(event, operation, command),
    callAltocProductFeedbackStatus: (command, operation) => sendProductFeedbackStatus(event, operation, command),
    callAltocProductFeedbackProgress: (command, operation) => sendProductFeedbackProgress(event, operation, command),
    callCodocsProductDocument: (command, operation) => callCodocsOperationService(event, command, operation.idempotencyKey, '', operation),
    callCodocsCompanySummary: (command, idempotencyKey, periodKey, operation) =>
      callCodocsOperationService(event, command, idempotencyKey, periodKey, operation)
  }
}

export function createScheduledServiceTicketDeliveryOperationIO(
  callRuntime: ServiceTicketDeliveryOperationIO['callRuntime'],
  targetDeployments: { codocs: string, altoc?: string, finance?: string }
): ServiceTicketDeliveryOperationIO {
  return {
    callRuntime,
    callAltoc: (command, idempotencyKey) => callAltocDeliveryService(null, command, idempotencyKey),
    callAltocReceivable: (command, idempotencyKey) => callAltocReceivableService(null, command, idempotencyKey),
    callPeople: (command, idempotencyKey) => callPeopleContributionService(null, command, idempotencyKey),
    callFinanceProductCostRules: (command, operation) => sendProductCostRules(null, operation, command, targetDeployments.finance || ''),
    callAltocProductFeedbackStatus: (command, operation) => sendProductFeedbackStatus(null, operation, command, targetDeployments.altoc || ''),
    callAltocProductFeedbackProgress: (command, operation) => sendProductFeedbackProgress(null, operation, command, targetDeployments.altoc || ''),
    callCodocsProductDocument: (command, operation) => callCodocsOperationService(null, command, operation.idempotencyKey, '', operation, targetDeployments.codocs),
    callCodocsCompanySummary: (command, idempotencyKey, periodKey, operation) =>
      callCodocsOperationService(
        null,
        command,
        idempotencyKey,
        periodKey,
        operation,
        targetDeployments.codocs
      )
  }
}

export async function dispatchServiceTicketDeliveryOperation(
  event: H3Event,
  operationKey: string,
  _operatorUid: string
) {
  const normalizedKey = text(operationKey)
  if (!normalizedKey) return { linked: false, synced: false }

  const io = createRequestServiceTicketDeliveryOperationIO(event)
  const operation = await io.callRuntime<ClaimedDeliveryOperation | null>(
    `/v1/aims/integration-operations/${encodeURIComponent(normalizedKey)}:claim`,
    {}
  )
  if (!operation) {
    return { linked: true, synced: false, pending: true, operation: null }
  }
  return await executeClaimedServiceTicketDeliveryOperation(operation, io, normalizedKey)
}

export async function dispatchMilestoneReceivableOperation(event: H3Event, operationKey: string) {
  const normalizedKey = text(operationKey)
  if (!normalizedKey) return { linked: false, synced: false }

  const io = createRequestServiceTicketDeliveryOperationIO(event)
  const operation = await io.callRuntime<ClaimedDeliveryOperation | null>(
    `/v1/aims/integration-operations/${encodeURIComponent(normalizedKey)}:claim`,
    {}
  )
  if (!operation) {
    return { linked: true, synced: false, pending: true, operation: null }
  }
  return await executeClaimedMilestoneReceivableOperation(operation, io, normalizedKey)
}

export async function dispatchPeopleContributionOperation(event: H3Event, operationKey: string) {
  const io = createRequestServiceTicketDeliveryOperationIO(event)
  const operation = await io.callRuntime<ClaimedDeliveryOperation | null>(`/v1/aims/integration-operations/${encodeURIComponent(text(operationKey))}:claim`, {})
  if (!operation) return { linked: true, synced: false, pending: true }
  const { executeClaimedPeopleContributionOperation } = await import('./peopleContributionOperationExecutor')
  return await executeClaimedPeopleContributionOperation(operation, io)
}

export async function dispatchCompanyWeeklySummaryOperation(event: H3Event, operationKey: string) {
  const normalizedKey = text(operationKey)
  if (!normalizedKey) return { linked: false, synced: false, pending: true }
  const io = createRequestServiceTicketDeliveryOperationIO(event)
  const operation = await io.callRuntime<ClaimedDeliveryOperation | null>(
    `/v1/aims/integration-operations/${encodeURIComponent(normalizedKey)}:claim`,
    {}
  )
  if (!operation) return { linked: true, synced: false, pending: true }
  return await executeClaimedCompanyWeeklySummaryOperation(operation, io, normalizedKey)
}
