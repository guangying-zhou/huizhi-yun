import { createError, getHeader, getRouterParam, readBody, setResponseStatus, type H3Event } from 'h3'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { crossAppForwardedHeaders } from '@hzy/foundation/server/utils/crossAppForwardedHeaders'
import { resolveServiceAppBaseUrl } from '@hzy/foundation/server/utils/serviceAppUrl'
import { serviceAppFetch } from '@hzy/foundation/server/utils/appServiceBinding'
import { requestServiceAccessToken } from '@hzy/foundation/server/utils/serviceOidc'
import { requirePermission } from '~~/server/utils/checkPermission'
import { getRequestUid } from '~~/server/utils/authIdentity'
import { resolveCurrentAltocDataAccessQuery } from '~~/server/utils/altocScopedAuthorization'
import {
  altocRuntimeErrorCode,
  altocRuntimeErrorStatus,
  isExplicitProjectEligible,
  selectLegacyContractProject,
  type ServiceTicketProjectResolution as ProjectResolution
} from '~~/server/utils/serviceTicketProjectResolution'
import { createRequestOpsKnowledgeOperationIO, claimOpsKnowledgeOperation } from '~~/server/utils/serviceTicketOpsKnowledgeOperation'
import { executeServiceTicketAimsOperation } from '~~/server/utils/serviceTicketAimsOperation'

interface RuntimeEnvelope<T> {
  code?: number | string
  data?: T
  message?: string
  status?: number
  statusCode?: number
  upstreamStatus?: number
  error?: {
    code?: string
    message?: string
  }
}

type RuntimeRow = Record<string, unknown>

interface AimsEligibleProjectsData {
  items?: RuntimeRow[]
}

interface ServiceAgreementDefaultProjectData {
  project_code?: string
  projectCode?: string
  reason?: string
}

function text(value: unknown) {
  return String(value || '').trim()
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, '')
}

function appendPath(baseUrl: string, path: string) {
  return `${trimTrailingSlash(baseUrl)}/${path.replace(/^\/+/, '')}`
}

function objectBody(value: unknown): RuntimeRow {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as RuntimeRow
  return {}
}

function firstText(source: RuntimeRow, ...keys: string[]) {
  for (const key of keys) {
    const value = text(source[key])
    if (value) return value
  }
  return ''
}

function resolveAimsBaseUrl(event: H3Event) {
  const baseUrl = resolveServiceAppBaseUrl(event, 'aims')
  if (!baseUrl) {
    throw createError({ statusCode: 503, message: 'Aims service API base URL is not configured.' })
  }
  return baseUrl
}

async function callAimsService<T>(
  event: H3Event,
  path: string,
  method: 'GET' | 'POST',
  scope: string,
  body?: RuntimeRow,
  idempotencyKey = ''
) {
  const token = await requestServiceAccessToken({
    audience: 'aims',
    scope,
    event
  })
  const response = await serviceAppFetch<RuntimeEnvelope<T>>(event, 'aims', appendPath(resolveAimsBaseUrl(event), path), {
    method,
    headers: {
      ...crossAppForwardedHeaders(event, { idempotencyKey: idempotencyKey }),
      authorization: `Bearer ${token}`,
      ...(method === 'POST' ? { 'content-type': 'application/json' } : {})
    },
    ...(method === 'POST' ? { body: body || {} } : {}),
    timeout: 10000
  })

  if (response.code !== undefined && response.code !== 0) {
    throw createError({ statusCode: 502, message: response.message || 'Aims service API returned an error.' })
  }
  return response.data as T
}

async function callAltocRuntime<T>(
  event: H3Event,
  path: string,
  options: {
    scope: string
    method: 'GET' | 'POST'
    query?: RuntimeRow
    body?: RuntimeRow
  }
) {
  const runtime = await maybeCallTenantRuntime<RuntimeEnvelope<T>>(event, path, {
    appCode: 'altoc',
    scope: options.scope,
    method: options.method,
    query: options.query,
    body: options.body
  })
  if (!runtime.handled) {
    throw createError({ statusCode: 503, message: 'Altoc tenant-runtime is required for this operation.' })
  }
  const envelope = runtime.data as RuntimeEnvelope<T> & RuntimeRow
  const runtimeErrorCode = altocRuntimeErrorCode(envelope)
  const runtimeErrorMessage = text(envelope.error?.message || envelope.message || runtimeErrorCode)
  const runtimeEnvelopeFailed = envelope.code !== undefined && String(envelope.code) !== '0'
  if (runtimeEnvelopeFailed || runtimeErrorCode) {
    const statusCode = altocRuntimeErrorStatus(envelope)
    throw createError({
      statusCode,
      statusMessage: runtimeErrorCode || 'altoc_runtime_error',
      message: runtimeErrorMessage || 'Altoc tenant-runtime returned an error.',
      data: {
        code: runtimeErrorCode || String(envelope.code || 'altoc_runtime_error'),
        message: runtimeErrorMessage,
        upstreamStatus: statusCode
      }
    })
  }
  return envelope.data as T
}

async function resolveProjectCode(
  event: H3Event,
  ticketCode: string,
  body: RuntimeRow,
  ticket: RuntimeRow,
  dataAccessQuery: RuntimeRow
): Promise<ProjectResolution | null> {
  const explicit = firstText(body, 'aimsProjectCode', 'aims_project_code', 'projectCode', 'project_code')
  const fromTicket = firstText(ticket, 'aims_project_code', 'aimsProjectCode', 'project_code', 'projectCode')
  const boundWorkItemKey = firstText(ticket, 'aims_work_item_key', 'aimsWorkItemKey')
  const contractCode = firstText(ticket, 'contract_code', 'contractCode')
  const customerCode = firstText(ticket, 'customer_code', 'customerCode')
  if (explicit) {
    if (boundWorkItemKey && fromTicket && explicit !== fromTicket) {
      throw createError({
        statusCode: 409,
        statusMessage: 'service_ticket_project_binding_conflict',
        message: 'The service ticket is already bound to an Aims work item in another project.',
        data: { code: 'service_ticket_project_binding_conflict', projectCode: fromTicket, workItemKey: boundWorkItemKey }
      })
    }
    if (explicit !== fromTicket) {
      const params = new URLSearchParams({
        project_code: explicit,
        include_linked: 'true',
        limit: '50'
      })
      if (contractCode) params.set('contract_code', contractCode)
      if (customerCode) params.set('customer_code', customerCode)

      const projectData = await callAimsService<AimsEligibleProjectsData>(
        event,
        `/api/v1/service/projects/eligible-for-contract?${params.toString()}`,
        'GET',
        'aims:read'
      )
      if (!isExplicitProjectEligible(explicit, customerCode, contractCode, projectData.items || [])) {
        throw createError({
          statusCode: 403,
          statusMessage: 'project_not_eligible',
          message: 'The selected Aims project is outside the scoped service ticket customer or contract.',
          data: { code: 'project_not_eligible' }
        })
      }
    }
    return { projectCode: explicit, source: 'explicit' }
  }
  if (fromTicket) return { projectCode: fromTicket, source: 'ticket' }

  const serviceAgreementCode = firstText(ticket, 'service_agreement_code', 'serviceAgreementCode', 'resolved_service_agreement_code')
  if (serviceAgreementCode) {
    try {
      const defaultProject = await callAltocRuntime<ServiceAgreementDefaultProjectData>(
        event,
        `/v1/altoc/service/service-agreements/${encodeURIComponent(serviceAgreementCode)}/default-project`,
        {
          scope: 'altoc.read altoc:contract:view',
          method: 'GET',
          query: { ...dataAccessQuery, allow_missing: 'true' }
        }
      )
      const defaultProjectCode = text(defaultProject?.project_code || defaultProject?.projectCode)
      if (defaultProjectCode) {
        return { projectCode: defaultProjectCode, source: 'service_agreement_default' }
      }
    } catch (error) {
      console.error('altoc.service_ticket_project_resolution_failed', {
        ticketCode,
        serviceAgreementCode,
        source: 'service_agreement_default',
        error
      })
      throw error
    }
  }

  if (!contractCode) return null

  const params = new URLSearchParams({
    contract_code: contractCode,
    contract_match: 'exact',
    limit: '2'
  })
  if (customerCode) params.set('customer_code', customerCode)

  const projectData = await callAimsService<AimsEligibleProjectsData>(
    event,
    `/api/v1/service/projects/eligible-for-contract?${params.toString()}`,
    'GET',
    'aims:read'
  )
  const legacySelection = selectLegacyContractProject(contractCode, projectData.items || [])
  if (legacySelection.errorCode) {
    throw createError({
      statusCode: 409,
      statusMessage: legacySelection.errorCode,
      message: 'Multiple Aims projects match this service ticket; select a project explicitly or configure a service agreement default project.',
      data: {
        code: legacySelection.errorCode,
        candidateProjectCodes: legacySelection.candidateProjectCodes || []
      }
    })
  }
  if (legacySelection.resolution) {
    return legacySelection.resolution
  }
  return null
}

export default defineEventHandler(async (event) => {
  const ticketCode = text(getRouterParam(event, 'ticketCode'))
  if (!ticketCode) {
    throw createError({ statusCode: 400, message: 'ticketCode is required.' })
  }

  await requirePermission(event, 'service_ticket', 'edit')

  const actorUid = getRequestUid(event)
  if (!actorUid) throw createError({ statusCode: 401, message: 'Verified actor is required.' })
  const body = objectBody(await readBody(event))
  const dataAccessQuery = await resolveCurrentAltocDataAccessQuery(event, 'service_ticket', 'edit')
  const ticket = await callAltocRuntime<RuntimeRow>(
    event,
    `/v1/altoc/service-tickets/${encodeURIComponent(ticketCode)}/dispatch-context`,
    {
      scope: 'altoc.read altoc:service_ticket:view',
      method: 'GET',
      query: dataAccessQuery
    }
  )
  const projectResolution = await resolveProjectCode(event, ticketCode, body, ticket, dataAccessQuery)
  if (!projectResolution?.projectCode) {
    throw createError({ statusCode: 400, message: 'projectCode is required to create an Aims work item from a service ticket.' })
  }

  const idempotencyKey = text(getHeader(event, 'idempotency-key')) || `altoc:service-ticket:${ticketCode}:aims-work-item:v1`
  const frozen = await callAltocRuntime<{ ticket?: RuntimeRow, operation?: { operationKey?: string, status?: string } }>(
    event,
    `/v1/altoc/service-tickets/${encodeURIComponent(ticketCode)}/aims-work-item:freeze`,
    { scope: 'altoc.write altoc:service_ticket:edit', method: 'POST', query: dataAccessQuery, body: {
      resolvedProjectCode: projectResolution.projectCode, resolvedProjectSource: projectResolution.source,
      operatorUid: actorUid, operator_uid: actorUid, current_user: actorUid, idempotencyKey
    } }
  )
  const operationKey = text(frozen.operation?.operationKey)
  if (!operationKey) throw createError({ statusCode: 409, message: 'Frozen Aims operation identity is missing.' })
  const io = createRequestOpsKnowledgeOperationIO(event, dataAccessQuery)
  let delivery: Record<string, unknown>
  try {
    const claimed = await claimOpsKnowledgeOperation(io, operationKey)
    const frozenStatus = text(frozen.operation?.status)
    delivery = claimed
      ? await executeServiceTicketAimsOperation(claimed, io)
      : frozenStatus === 'succeeded'
        ? { succeeded: true, pending: false }
        : ['failed_permanent', 'dead_letter'].includes(frozenStatus)
            ? { succeeded: false, pending: false, failed: true, errorCode: 'integration_operation_permanent_failure' }
            : { succeeded: false, pending: true }
  } catch {
    delivery = { succeeded: false, pending: true, errorCode: 'integration_dispatch_unavailable' }
  }
  setResponseStatus(event, delivery.succeeded ? 200 : delivery.failed ? 409 : 202)

  return {
    code: 0,
    message: 'ok',
    data: {
      ticket: frozen.ticket,
      projectCode: projectResolution.projectCode,
      projectSource: projectResolution.source,
      delivery,
      workItemKey: 'workItemKey' in delivery ? delivery.workItemKey : null,
      operation: frozen.operation
    }
  }
})
