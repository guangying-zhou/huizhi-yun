import { buildAppHomeUrl } from '@hzy/foundation/server/utils/appUrls'
import { crossAppForwardedHeaders } from '@hzy/foundation/server/utils/crossAppForwardedHeaders'
import { getConsoleRuntimeConfig } from '@hzy/foundation/server/utils/consoleRuntime'
import { requestServiceAccessToken } from '@hzy/foundation/server/utils/serviceOidc'
import { resolveServiceAppBaseUrl } from '@hzy/foundation/server/utils/serviceAppUrl'
import {
  buildServiceCommandRuntimeHeaders,
  hashServiceCommandPayload
} from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { resolveTrustedTenantGatewayContext } from '@hzy/foundation/server/utils/tenantGatewayTrust'
import { getHeader, type H3Event } from 'h3'

interface CodocsCreateResponse {
  code?: number
  data?: {
    uuid?: string
    title?: string
  }
}

interface CodocsContentResponse {
  code?: number
  data?: {
    uuid: string
    title: string
    docType: string
    ownerUid: string
    deptCode: string | null
    projectCode: string | null
    contentSize: number
    content: string
    createdAt: string
    updatedAt: string
  }
}

interface CodocsSummaryResponse {
  code?: number
  data?: {
    uuid: string
    title: string
    docType: string
    ownerUid: string
    updatedAt: string
  }
}

export type AltocEntityType = 'opportunity' | 'contract' | 'quotation' | 'customer' | 'lead' | 'tender'
type AltocEntityDocumentAction = 'content:read' | 'attach:authorize'

interface CodocsEntityDocumentResponse {
  code?: number
  message?: string
  data?: CodocsContentResponse['data'] | {
    uuid?: string
    title?: string
    docType?: string
    contentSize?: number
    content?: string
    updatedAt?: string
  }
}

function stringValue(value: unknown) {
  return String(value || '').trim()
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, '')
}

function joinApiRoot(homeUrl: string, apiBase: string) {
  const base = homeUrl.endsWith('/') ? homeUrl : `${homeUrl}/`
  const path = apiBase.replace(/^\/+/, '')
  return new URL(path, base).toString().replace(/\/+$/, '')
}

async function getCodocsApiRoot() {
  try {
    const runtime = await getConsoleRuntimeConfig()
    const deployment = runtime.deployment as Record<string, unknown> | undefined
    const applications = Array.isArray(runtime.applications) ? runtime.applications : []
    const codocs = applications.find(item => stringValue(item.appCode) === 'codocs')

    if (codocs) {
      const homeUrl = stringValue(codocs.homeUrl)
        || buildAppHomeUrl(deployment?.publicUrl, codocs.basePath)
      const apiBase = stringValue(codocs.apiBase) || '/api/v1/codocs'
      if (homeUrl) return joinApiRoot(homeUrl, apiBase)
    }
  } catch {
    // Console runtime 不可用时回退到本地开发 URL。
  }

  const config = useRuntimeConfig() as unknown as { codocsApiUrl?: string, public?: { codocsBaseUrl?: string } }
  const codocsBaseUrl = stringValue(config.codocsApiUrl)
    || stringValue(config.public?.codocsBaseUrl)
    || 'http://localhost:3001'
  return `${trimTrailingSlash(codocsBaseUrl)}/api/v1/codocs`
}

async function getCodocsServiceApiRoot(event: H3Event) {
  const direct = resolveServiceAppBaseUrl(event, 'codocs')
  if (/^https?:\/\//iu.test(direct)) return `${trimTrailingSlash(direct)}/api/v1`

  try {
    const runtime = await getConsoleRuntimeConfig({ event })
    const deployment = runtime.deployment as Record<string, unknown> | undefined
    const applications = Array.isArray(runtime.applications) ? runtime.applications : []
    const codocs = applications.find(item => stringValue(item.appCode) === 'codocs')
    if (codocs) {
      const homeUrl = stringValue(codocs.homeUrl)
        || buildAppHomeUrl(deployment?.publicUrl, codocs.basePath)
      if (homeUrl) return `${trimTrailingSlash(homeUrl)}/api/v1`
    }
  } catch {
    // Local development can use the explicit Codocs base URL below.
  }

  const config = useRuntimeConfig() as unknown as { codocsApiUrl?: string, public?: { codocsBaseUrl?: string } }
  const base = stringValue(config.codocsApiUrl)
    || stringValue(config.public?.codocsBaseUrl)
    || 'http://localhost:3001'
  return `${trimTrailingSlash(base)}/api/v1`
}

async function callAltocEntityDocumentService(params: {
  event: H3Event
  actorUid: string
  entityType: AltocEntityType
  entityId: number
  documentUuid: string
  action: AltocEntityDocumentAction
}) {
  const actorUid = stringValue(params.actorUid)
  const entityType = stringValue(params.entityType)
  const documentUuid = stringValue(params.documentUuid)
  const entityId = Number(params.entityId)
  if (!actorUid || !entityType || !documentUuid || !Number.isSafeInteger(entityId) || entityId <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Altoc 实体文档命令上下文不完整' })
  }

  const command = { actorUid, entityType, entityId, documentUuid, action: params.action }
  const commandSha256 = await hashServiceCommandPayload(command)
  const isContent = params.action === 'content:read'
  const serviceCommand = {
    operationId: `altoc.codocs.entity-document.${isContent ? 'content' : 'attach'}:${commandSha256.slice(0, 24)}`,
    targetApp: 'codocs',
    operationCode: isContent
      ? 'altoc.codocs.entity-document.content-read.v1'
      : 'altoc.codocs.entity-document.attach-authorize.v1',
    requiredCapability: isContent
      ? 'codocs:altoc-entity-document:content:read'
      : 'codocs:altoc-entity-document:attach',
    idempotencyKey: `altoc:codocs:entity-document:${isContent ? 'content' : 'attach'}:${commandSha256.slice(0, 32)}`,
    commandSchemaVersion: isContent
      ? 'altoc.codocs.entity-document.content.v1'
      : 'altoc.codocs.entity-document.attach.v1',
    commandSha256,
    command
  }
  const apiRoot = await getCodocsServiceApiRoot(params.event)
  const route = isContent ? 'content' : 'attach'
  const url = `${apiRoot}/service/altoc-entity-documents/${encodeURIComponent(documentUuid)}/${route}`
  const requestTarget = new URL(url).pathname
  const sourceAuth = params.event.context.consoleAuth as { tenant?: unknown, deployment?: unknown } | undefined
  const gateway = resolveTrustedTenantGatewayContext(params.event)
  const tenantCode = stringValue(gateway?.tenant || sourceAuth?.tenant)
  const deploymentCode = stringValue(gateway?.deployment || sourceAuth?.deployment)
  if (!tenantCode || !deploymentCode) {
    throw createError({ statusCode: 503, statusMessage: 'Altoc 实体文档命令缺少可信租户部署上下文' })
  }
  const requestId = stringValue(getHeader(params.event, 'x-request-id') || getHeader(params.event, 'x-correlation-id')) || crypto.randomUUID()
  const token = await requestServiceAccessToken({
    audience: 'codocs',
    scope: serviceCommand.requiredCapability,
    event: params.event
  })
  const signedHeaders = await buildServiceCommandRuntimeHeaders({
    token,
    method: 'POST',
    requestTarget,
    requestId,
    tenantCode,
    sourceDeploymentCode: deploymentCode,
    targetDeploymentCode: deploymentCode,
    sourceApp: 'altoc',
    sourceClientId: 'altoc',
    targetApp: 'codocs',
    envelope: serviceCommand
  })
  const response = await $fetch<CodocsEntityDocumentResponse>(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'x-request-id': requestId,
      'x-hzy-tenant': tenantCode,
      'x-hzy-deployment': deploymentCode,
      ...crossAppForwardedHeaders(params.event),
      ...signedHeaders
    },
    body: { serviceCommand },
    timeout: isContent ? 15000 : 10000
  })
  if (!response.data?.uuid) {
    throw createError({ statusCode: response.code !== undefined && response.code !== 0 ? 502 : 404, statusMessage: response.message || 'Codocs 文档不存在或无权访问' })
  }
  return response.data
}

async function getAuthHeaders(scope: 'codocs:documents:read' | 'codocs:documents:write') {
  const token = await requestServiceAccessToken({
    audience: 'codocs',
    scope
  })
  return { Authorization: `Bearer ${token}` }
}

export async function createCodocsDocument(params: {
  title: string
  ownerUid: string
  content?: string
  docType?: string
  projectCode?: string
}) {
  const apiRoot = await getCodocsApiRoot()
  const response = await $fetch<CodocsCreateResponse>(`${apiRoot}/documents`, {
    method: 'POST',
    headers: await getAuthHeaders('codocs:documents:write'),
    body: {
      title: params.title,
      ownerUid: params.ownerUid,
      content: params.content || '',
      docType: params.docType || 'sale',
      projectCode: params.projectCode || null
    },
    timeout: 10000
  })

  const uuid = response.data?.uuid
  if (!uuid) {
    throw createError({ statusCode: 502, statusMessage: 'Codocs 未返回文档 UUID' })
  }

  return {
    uuid,
    title: response.data?.title || params.title
  }
}

export async function getCodocsDocumentContent(uuid: string) {
  const apiRoot = await getCodocsApiRoot()
  const response = await $fetch<CodocsContentResponse>(`${apiRoot}/documents/${encodeURIComponent(uuid)}/content`, {
    headers: await getAuthHeaders('codocs:documents:read'),
    timeout: 15000
  })

  if (!response.data) {
    throw createError({ statusCode: 502, statusMessage: 'Codocs 未返回文档内容' })
  }

  return response.data
}

export async function getCodocsDocumentSummary(uuid: string) {
  const apiRoot = await getCodocsApiRoot()
  const response = await $fetch<CodocsSummaryResponse>(`${apiRoot}/documents/${encodeURIComponent(uuid)}/summary`, {
    headers: await getAuthHeaders('codocs:documents:read'),
    timeout: 10000
  })

  if (!response.data) {
    throw createError({ statusCode: 502, statusMessage: 'Codocs 未返回文档摘要' })
  }

  return response.data
}

/** Exact Altoc entity link + Codocs ACL intersection; never a generic read. */
export async function getCodocsAltocEntityDocumentContent(params: {
  event: H3Event
  actorUid: string
  entityType: AltocEntityType
  entityId: number
  documentUuid: string
}) {
  return await callAltocEntityDocumentService({ ...params, action: 'content:read' })
}

/** Proves the actor can edit/share the exact Codocs document before Altoc writes a link. */
export async function authorizeCodocsAltocEntityDocumentAttach(params: {
  event: H3Event
  actorUid: string
  entityType: AltocEntityType
  entityId: number
  documentUuid: string
}) {
  return await callAltocEntityDocumentService({ ...params, action: 'attach:authorize' })
}
