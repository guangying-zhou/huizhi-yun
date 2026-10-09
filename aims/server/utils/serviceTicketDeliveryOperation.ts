import { callCodocsOperationService } from './codocsOperationTransport'
import { unifiedIntegrationOperationRoute } from './unifiedIntegrationOperationRoute'
import { sendProductFeedbackProgress } from './productFeedbackProgressTransport'
import { sendProductCostRules } from './productCostRulesTransport'
import { sendProductFeedbackStatus } from './productFeedbackStatusTransport'
import { sendWorkItemCompletion } from './workItemCompletionTransport'
import { createError, getHeader, type H3Event } from 'h3'
import { serviceAppFetch } from '@hzy/foundation/server/utils/appServiceBinding'
import type { requireTenantGatewaySchedulerRequest } from '@hzy/foundation/server/utils/tenantGatewayTrust'
import {
  maybeCallTenantRuntime
} from '@hzy/foundation/server/utils/tenantRuntimeClient'
import {
  resolveServiceAppBaseUrl
} from '@hzy/foundation/server/utils/serviceAppUrl'
import { requestWithServiceAccessToken, trustedServiceRequestHeaders } from '@hzy/foundation/server/utils/serviceOidc'
import {
  executeClaimedServiceTicketDeliveryOperation,
  type ClaimedDeliveryOperation,
  type RuntimeRow,
  type ServiceTicketDeliveryOperationIO
} from './serviceTicketDeliveryOperationExecutor'
import { executeClaimedMilestoneReceivableOperation } from './milestoneReceivableOperationExecutor'
import { executeClaimedCompanyWeeklySummaryOperation } from './companyWeeklySummaryOperationExecutor'

export { callCodocsOperationService } from './codocsOperationTransport'

interface RuntimeEnvelope<T> {
  code?: number | string
  data?: T
  message?: string
}

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

export function createRequestServiceTicketDeliveryOperationIO(event: H3Event, verifiedScheduler?: VerifiedScheduler): ServiceTicketDeliveryOperationIO {
  return {
    callWorkflowWorkItemCompletion: (command, operation) => sendWorkItemCompletion(event, operation, command),
    callRuntime: <T>(path: string, body: RuntimeRow) => callAimsOperationRuntime<T>(event, path, body),
    callAltoc: (command, idempotencyKey) => callAltocDeliveryService(event, command, idempotencyKey),
    callAltocReceivable: (command, idempotencyKey) => callAltocReceivableService(event, command, idempotencyKey),
    callPeople: (command, idempotencyKey) => callPeopleContributionService(event, command, idempotencyKey),
    callFinanceProductCostRules: (command, operation) => sendProductCostRules(event, operation, command),
    callAltocProductFeedbackStatus: (command, operation) => sendProductFeedbackStatus(event, operation, command),
    callAltocProductFeedbackProgress: (command, operation) => sendProductFeedbackProgress(event, operation, command),
    callCodocsProductDocument: (command, operation) => callCodocsOperationService(event, command, operation.idempotencyKey, '', operation),
    callCodocsCompanySummary: (command, idempotencyKey, periodKey, operation) =>
      callCodocsOperationService(event, command, idempotencyKey, periodKey, operation, '', verifiedScheduler)
  }
}

// All persistence calls (including notification checkpoints) share the same
// signed selection. External transports retain the real Aims event identity.
export function createUnifiedRequestServiceTicketDeliveryOperationIO(event: H3Event, generation: string, verifiedScheduler?: VerifiedScheduler): ServiceTicketDeliveryOperationIO {
  const io = createRequestServiceTicketDeliveryOperationIO(event, verifiedScheduler)
  return { ...io, callRuntime: async <T>(path: string, body: RuntimeRow) => {
    const routed = unifiedIntegrationOperationRoute(path, body)
    const runtime = await maybeCallTenantRuntime<RuntimeEnvelope<T>>(event, routed.path, {
      appCode: 'aims', scope: 'aims:integration_operation:execute', capabilityFormat: 'business',
      serviceTokenSourceBinding: 'service-client-policy', enterpriseScheduler: { generation },
      method: 'POST', query: {}, body: routed.body
    })
    if (!runtime.handled) throw createError({ statusCode: 503, message: 'Unified Aims scheduler Runtime is unavailable.' })
    if (runtime.data.code !== undefined && String(runtime.data.code) !== '0') {
      throw createError({ statusCode: 502, message: runtime.data.message || 'Unified Aims integration operation failed.' })
    }
    return runtime.data.data as T
  } }
}

export function createScheduledServiceTicketDeliveryOperationIO(
  callRuntime: ServiceTicketDeliveryOperationIO['callRuntime'],
  targetDeployments: { codocs: string, altoc?: string, finance?: string, workflow?: string },
  taskContext?: import('./workItemCompletionTransport').CompletionScheduledContext
): ServiceTicketDeliveryOperationIO {
  return {
    callRuntime,
    callWorkflowWorkItemCompletion: (command, operation) => sendWorkItemCompletion(null, operation, command, targetDeployments.workflow || '', taskContext),
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
