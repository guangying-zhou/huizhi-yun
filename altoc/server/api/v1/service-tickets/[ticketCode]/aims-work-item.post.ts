import { createError, getHeader, getRouterParam, readBody, type H3Event } from 'h3'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { resolveServiceAppBaseUrl } from '@hzy/foundation/server/utils/serviceAppUrl'
import { requestServiceAccessToken } from '@hzy/foundation/server/utils/serviceOidc'
import { requirePermission } from '~~/server/utils/checkPermission'
import { getRequestUid } from '~~/server/utils/authIdentity'
import { resolveCurrentAltocDataAccessQuery } from '~~/server/utils/altocScopedAuthorization'
import {
  altocRuntimeErrorCode,
  altocRuntimeErrorStatus,
  selectLegacyContractProject,
  type ServiceTicketProjectResolution as ProjectResolution
} from '~~/server/utils/serviceTicketProjectResolution'

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

interface AimsWorkItemData {
  workItem?: RuntimeRow
  created?: boolean
  idempotent?: boolean
}

interface AimsEligibleProjectsData {
  items?: RuntimeRow[]
}

interface AltocDeliveryResultData {
  ticket?: RuntimeRow
  updated?: boolean
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

function forwardedContextHeaders(event: H3Event, idempotencyKey = '') {
  const headers: Record<string, string> = {}
  for (const name of [
    'x-hzy-gateway',
    'x-hzy-gateway-token',
    'x-hzy-tenant',
    'x-hzy-deployment',
    'x-hzy-environment',
    'x-hzy-tenant-runtime-url',
    'x-hzy-tenant-runtime-token',
    'x-hzy-tenant-runtime-audience',
    'x-hzy-data-runtime-url',
    'x-hzy-data-runtime-token',
    'x-hzy-data-runtime-audience',
    'x-forwarded-host',
    'x-forwarded-port',
    'x-forwarded-prefix',
    'x-forwarded-proto'
  ]) {
    const value = text(getHeader(event, name))
    if (value) headers[name] = value
  }

  const requestId = text(getHeader(event, 'x-request-id') || getHeader(event, 'x-correlation-id'))
  if (requestId) headers['x-request-id'] = requestId
  if (idempotencyKey) headers['idempotency-key'] = idempotencyKey
  return headers
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
  const response = await $fetch<RuntimeEnvelope<T>>(appendPath(resolveAimsBaseUrl(event), path), {
    method,
    headers: {
      ...forwardedContextHeaders(event, idempotencyKey),
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

async function resolveProjectCode(event: H3Event, ticketCode: string, body: RuntimeRow, ticket: RuntimeRow): Promise<ProjectResolution | null> {
  const explicit = firstText(body, 'aimsProjectCode', 'aims_project_code', 'projectCode', 'project_code')
  const fromTicket = firstText(ticket, 'aims_project_code', 'aimsProjectCode', 'project_code', 'projectCode')
  if (explicit) return { projectCode: explicit, source: 'explicit' }
  if (fromTicket) return { projectCode: fromTicket, source: 'ticket' }

  const serviceAgreementCode = firstText(body, 'serviceAgreementCode', 'service_agreement_code')
    || firstText(ticket, 'service_agreement_code', 'serviceAgreementCode')
  if (serviceAgreementCode) {
    try {
      const defaultProject = await callAltocRuntime<ServiceAgreementDefaultProjectData>(
        event,
        `/v1/altoc/service/service-agreements/${encodeURIComponent(serviceAgreementCode)}/default-project`,
        {
          scope: 'altoc.read altoc:contract:view',
          method: 'GET',
          query: { allow_missing: 'true' }
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

  const contractCode = firstText(body, 'contractCode', 'contract_code') || firstText(ticket, 'contract_code', 'contractCode')
  if (!contractCode) return null

  const customerCode = firstText(body, 'customerCode', 'customer_code') || firstText(ticket, 'customer_code', 'customerCode')
  const params = new URLSearchParams({
    contract_code: contractCode,
    include_linked: 'true',
    limit: '50'
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

function serviceTicketPayload(ticketCode: string, body: RuntimeRow, ticket: RuntimeRow, resolution: ProjectResolution, actorUid: string) {
  return {
    ticketCode,
    ticket,
    projectCode: resolution.projectCode,
    aimsProjectCode: resolution.projectCode,
    projectSource: resolution.source,
    project_source: resolution.source,
    ticketType: firstText(body, 'ticketType', 'ticket_type') || firstText(ticket, 'ticket_type', 'ticketType'),
    title: firstText(body, 'title', 'name') || firstText(ticket, 'title', 'name') || ticketCode,
    description: firstText(body, 'description', 'content', 'remark') || firstText(ticket, 'description', 'content', 'remark'),
    priority: firstText(body, 'priority') || firstText(ticket, 'priority'),
    customerCode: firstText(body, 'customerCode', 'customer_code') || firstText(ticket, 'customer_code', 'customerCode'),
    customerName: firstText(body, 'customerName', 'customer_name') || firstText(ticket, 'customer_name', 'customerName'),
    contractCode: firstText(body, 'contractCode', 'contract_code') || firstText(ticket, 'contract_code', 'contractCode'),
    maintenanceContractCode: firstText(body, 'maintenanceContractCode', 'maintenance_contract_code') || firstText(ticket, 'maintenance_contract_code', 'maintenanceContractCode'),
    deliveryCode: firstText(body, 'deliveryCode', 'delivery_code') || firstText(ticket, 'delivery_code', 'deliveryCode'),
    productCode: firstText(body, 'productCode', 'product_code') || firstText(ticket, 'product_code', 'productCode'),
    productVersion: firstText(body, 'productVersion', 'product_version') || firstText(ticket, 'product_version', 'productVersion'),
    ownerUserId: firstText(body, 'ownerUserId', 'owner_user_id') || firstText(ticket, 'owner_user_id', 'ownerUserId'),
    handlerUserId: firstText(body, 'handlerUserId', 'handler_user_id') || firstText(ticket, 'handler_user_id', 'handlerUserId'),
    resolutionDueAt: firstText(body, 'resolutionDueAt', 'resolution_due_at') || firstText(ticket, 'resolution_due_at', 'resolutionDueAt'),
    createdBy: actorUid,
    operatorUid: actorUid
  }
}

export default defineEventHandler(async (event) => {
  const ticketCode = text(getRouterParam(event, 'ticketCode'))
  if (!ticketCode) {
    throw createError({ statusCode: 400, message: 'ticketCode is required.' })
  }

  await requirePermission(event, 'service_ticket', 'edit')

  const actorUid = getRequestUid(event) || 'system'
  const body = objectBody(await readBody(event))
  const dataAccessQuery = await resolveCurrentAltocDataAccessQuery(event, 'service_ticket', 'edit')
  const ticket = await callAltocRuntime<RuntimeRow>(
    event,
    `/v1/altoc/service-tickets/${encodeURIComponent(ticketCode)}`,
    {
      scope: 'altoc.read altoc:service_ticket:view',
      method: 'GET',
      query: dataAccessQuery
    }
  )
  const projectResolution = await resolveProjectCode(event, ticketCode, body, ticket)
  if (!projectResolution?.projectCode) {
    throw createError({ statusCode: 400, message: 'projectCode is required to create an Aims work item from a service ticket.' })
  }

  const idempotencyKey = text(getHeader(event, 'idempotency-key')) || `altoc:service-ticket:${ticketCode}:aims-work-item:v1`
  const workItemData = await callAimsService<AimsWorkItemData>(
    event,
    `/api/v1/service/service-tickets/${encodeURIComponent(ticketCode)}/work-item`,
    'POST',
    'aims:write',
    {
      ...serviceTicketPayload(ticketCode, body, ticket, projectResolution, actorUid),
      idempotencyKey
    },
    idempotencyKey
  )
  const workItem = workItemData.workItem || {}
  const workItemKey = firstText(workItem, 'item_key', 'itemKey', 'key')
  if (!workItemKey) {
    throw createError({ statusCode: 502, message: 'Aims work item response did not include item_key.' })
  }

  const deliveryResult = await callAltocRuntime<AltocDeliveryResultData>(
    event,
    `/v1/altoc/service/service-tickets/${encodeURIComponent(ticketCode)}/delivery-result:sync`,
    {
      scope: 'altoc.write altoc:service_ticket:delivery-result:sync',
      method: 'POST',
      query: dataAccessQuery,
      body: {
        aimsProjectCode: projectResolution.projectCode,
        projectSource: projectResolution.source,
        project_source: projectResolution.source,
        workItemKey,
        workItemType: firstText(workItem, 'type'),
        deliveryStatus: 'processing',
        operatorUid: actorUid,
        idempotencyKey
      }
    }
  )

  return {
    code: 0,
    message: 'ok',
    data: {
      workItem,
      ticket: deliveryResult.ticket,
      projectCode: projectResolution.projectCode,
      projectSource: projectResolution.source,
      created: workItemData.created === true,
      idempotent: workItemData.idempotent === true,
      updated: deliveryResult.updated === true
    }
  }
})
