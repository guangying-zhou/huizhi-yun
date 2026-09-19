/**
 * Codocs API 客户端
 * 使用 Console service token 调用 Codocs 模块间接口
 */
import { buildAppHomeUrl, getRequestOrigin } from '@hzy/foundation/server/utils/appUrls'
import { callCodocsProjectAccess } from './codocsProjectAccessClient'
import { serviceAppFetch } from '@hzy/foundation/server/utils/appServiceBinding'
import {
  resolveServiceAppBaseUrl,
  resolveTrustedServiceAppRoute
} from '@hzy/foundation/server/utils/serviceAppUrl'
import { getConsoleRuntimeConfig } from '@hzy/foundation/server/utils/consoleRuntime'
import {
  requestServiceAccessToken,
  trustedServiceRequestHeaders
} from '@hzy/foundation/server/utils/serviceOidc'
import {
  buildServiceCommandRuntimeHeaders,
  hashServiceCommandPayload
} from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { resolveTrustedTenantGatewayContext } from '@hzy/foundation/server/utils/tenantGatewayTrust'
import { createError, getHeader, type H3Event } from 'h3'
import {
  codocsUpstreamMessage,
  codocsUpstreamStatus
} from './codocsProjectCabinetFallback'

interface CodocsFolderItem {
  id: number
  name: string
  folder_type: string
  owner_uid: string
  dept_code: string | null
  project_code: string | null
  parent_id: number | null
  sort_order: number
  created_at: string
  updated_at: string
}

interface CodocsDocumentMetadataRow {
  uuid?: string
  title?: string | null
  doc_type?: string | null
  owner_uid?: string | null
  dept_code?: string | null
  project_code?: string | null
  status?: number | string | null
  content_size?: number | string | null
  ai_abstract?: string | null
  readonly_flag?: number | string | null
  last_editor_uid?: string | null
  created_at?: string | null
  updated_at?: string | null
}

interface CodocsDocumentSummaryResponse {
  code: number
  data: {
    uuid: string
    title: string
    docType: string
    ownerUid: string
    ownerName: string
    deptCode: string | null
    projectCode: string | null
    status: number
    contentSize: number
    aiAbstract: string | null
    readonlyFlag: number
    lastEditorUid: string | null
    lastEditorName: string | null
    createdAt: string
    updatedAt: string
  }
}

interface CodocsDocumentContentData {
  uuid?: string
  title?: string
  docType?: string
  doc_type?: string
  ownerUid?: string
  owner_uid?: string
  deptCode?: string | null
  dept_code?: string | null
  projectCode?: string | null
  project_code?: string | null
  contentSize?: number
  content_size?: number
  content?: string
  createdAt?: string
  created_at?: string
  updatedAt?: string
  updated_at?: string
}

interface CodocsDocumentContentResponse {
  code?: number
  success?: boolean
  message?: string
  data?: CodocsDocumentContentData | null
}

const CODOCS_SUMMARY_TIMEOUT_MS = 20000
const CODOCS_CONTENT_TIMEOUT_MS = 30000
const CODOCS_DOCUMENT_CREATE_TIMEOUT_MS = 60000

export interface DocumentAccessGrantInput {
  subjectType: 'project' | 'dept' | 'user' | 'role'
  subjectCode: string
  permission: 'view' | 'download' | 'edit'
  expiresAt?: string | null
}

export interface DocumentAccessPolicy {
  id: number
  documentRefType: 'codocs_document' | 'cabinet_file'
  documentUuid: string
  sourceApp: string
  sourceProjectCode: string
  lifecycleStage: 'draft' | 'formal' | 'archived'
  confidentialityLevel: 'L0' | 'L1' | 'L2' | 'L3'
  defaultPermission: 'none' | 'view' | 'download'
  allowInternalAccess: boolean
  allowCrossProject: boolean
  readonly: boolean
  grants: Array<{
    id: number
    policyId: number
    subjectType: 'project' | 'dept' | 'user' | 'role'
    subjectCode: string
    permission: 'view' | 'download' | 'edit'
    expiresAt: string | null
    createdBy: string
    createdAt: string
  }>
}

export interface DocumentAccessCheckResult {
  allowed: boolean
  permission: 'none' | 'view' | 'download' | 'edit'
  readonly: boolean
  reason: string
  lifecycleStage: 'draft' | 'formal' | 'archived'
  confidentialityLevel: 'L0' | 'L1' | 'L2' | 'L3'
}

export interface DocumentAccessAuditLog {
  id: number
  documentRefType: 'codocs_document' | 'cabinet_file'
  documentUuid: string
  actorUid: string | null
  action: string
  decision: 'allow' | 'deny'
  reason: string
  sourceProjectCode: string | null
  actorProjectCodes: string[]
  createdAt: string
}

export interface DocumentAccessAuditListResult {
  items: DocumentAccessAuditLog[]
  total: number
  page: number
  pageSize: number
}

interface CabinetUploadResponse {
  success: number
  failed: number
  items: Array<{
    filename: string
    status: string
    message?: string
    uuid?: string
    ossPath?: string
    fileExt?: string
    fileSize?: number
  }>
}

type CabinetUploadItem = CabinetUploadResponse['items'][number]

interface CabinetDownloadUrlResponse {
  code?: number
  message?: string
  data?: {
    url?: string
    uuid?: string
    originalName?: string
    fileExt?: string
    fileSize?: number
    ossPath?: string
    projectCode?: string
  }
}

interface CabinetPreviewUrlResponse {
  code?: number
  message?: string
  data?: {
    previewable?: boolean
    previewType?: string
    previewUrl?: string
    content?: string
    encoding?: string
    truncated?: boolean
    uuid?: string
    originalName?: string
    fileExt?: string
    fileSize?: number
    ossPath?: string
    projectCode?: string
  }
}

interface CabinetDeleteResponse {
  code?: number
  message?: string
  data?: {
    uuid?: string
    ossPath?: string
    projectCode?: string
    recycledPath?: string | null
    missingOssObject?: boolean
  }
}

function getCodocsConfig() {
  const config = useRuntimeConfig()
  const codocsUrl = (config.public?.codocsUrl as string) || 'http://localhost:3001'
  return { codocsUrl }
}

function stringValue(value: unknown) {
  return String(value || '').trim()
}

function numberValue(value: unknown, fallback = 0) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, '')
}

function normalizeCodocsDocumentSummary(doc: CodocsDocumentMetadataRow): CodocsDocumentSummaryResponse {
  const ownerUid = stringValue(doc.owner_uid)
  const lastEditorUid = stringValue(doc.last_editor_uid)
  return {
    code: 0,
    data: {
      uuid: stringValue(doc.uuid),
      title: stringValue(doc.title),
      docType: stringValue(doc.doc_type),
      ownerUid,
      ownerName: ownerUid,
      deptCode: doc.dept_code || null,
      projectCode: doc.project_code || null,
      status: numberValue(doc.status),
      contentSize: numberValue(doc.content_size),
      aiAbstract: doc.ai_abstract || null,
      readonlyFlag: numberValue(doc.readonly_flag),
      lastEditorUid: lastEditorUid || null,
      lastEditorName: lastEditorUid || null,
      createdAt: stringValue(doc.created_at),
      updatedAt: stringValue(doc.updated_at)
    }
  }
}

function normalizeCodocsHomeUrl(value: unknown, event?: H3Event) {
  const normalized = trimTrailingSlash(stringValue(value))
  if (!normalized) return ''
  if (/^https?:\/\//i.test(normalized)) return normalized
  if (event && normalized.startsWith('/')) {
    return trimTrailingSlash(new URL(normalized, `${getRequestOrigin(event)}/`).toString())
  }
  return normalized
}

function joinApiRoot(homeUrl: string, apiBase: string) {
  const base = homeUrl.endsWith('/') ? homeUrl : `${homeUrl}/`
  const path = apiBase.replace(/^\/+/, '')
  return new URL(path, base).toString().replace(/\/+$/, '')
}

/**
 * 服务端到 codocs 的调用必须直连 codocs 独立服务子域名（managed-cloud 下为
 * https://codocs.<suffix>/codocs），不能回环到统一网关（wiztek.<suffix>/codocs）。
 * 否则 aims Worker 的子请求会回环到同 zone 的网关 Worker，写文档等较慢操作会触发
 * Cloudflare 522（连接超时）。与 altoc/people/assets 的服务端调用保持一致。
 * 仅在解析出 https 直连地址时启用；本地开发回退到既有 Console runtime / codocsUrl 逻辑。
 */
function directCodocsServiceBaseUrl(event?: H3Event) {
  // 不把入站 event 交给 resolver：managed-cloud 下带 event 的解析会优先返回当前
  // 租户网关（wiztek.<suffix>/codocs），导致 Worker 子请求回环。租户/部署/runtime
  // 上下文仍由 forwardedCodocsContextHeaders(event) 显式转发给独立 codocs 服务。
  if (!event) return ''
  const url = resolveServiceAppBaseUrl(null, 'codocs')
  return /^https:\/\//i.test(url) ? trimTrailingSlash(url) : ''
}

async function getCodocsApiRoot(event?: H3Event) {
  const directBase = directCodocsServiceBaseUrl(event)
  if (directBase) return joinApiRoot(directBase, '/api/v1/codocs')

  try {
    const runtime = await getConsoleRuntimeConfig(event ? { event } : undefined)
    const deployment = runtime.deployment as Record<string, unknown> | undefined
    const applications = Array.isArray(runtime.applications) ? runtime.applications : []
    const codocs = applications.find(item => stringValue(item.appCode) === 'codocs')

    if (codocs) {
      const homeUrl = normalizeCodocsHomeUrl(codocs.homeUrl, event)
        || buildAppHomeUrl(deployment?.publicUrl, codocs.basePath)
      const apiBase = stringValue(codocs.apiBase) || '/api/v1/codocs'
      if (homeUrl) return joinApiRoot(homeUrl, apiBase)
    }
  } catch {
    // Console runtime 不可用时回退到显式配置，保持本地开发和旧部署可用。
  }

  const { codocsUrl } = getCodocsConfig()
  return `${normalizeCodocsHomeUrl(codocsUrl, event)}/api/v1/codocs`
}

async function getCodocsHomeUrl(event?: H3Event) {
  const directBase = directCodocsServiceBaseUrl(event)
  if (directBase) return directBase

  try {
    const runtime = await getConsoleRuntimeConfig(event ? { event } : undefined)
    const deployment = runtime.deployment as Record<string, unknown> | undefined
    const applications = Array.isArray(runtime.applications) ? runtime.applications : []
    const codocs = applications.find(item => stringValue(item.appCode) === 'codocs')

    if (codocs) {
      const homeUrl = normalizeCodocsHomeUrl(codocs.homeUrl, event)
        || buildAppHomeUrl(deployment?.publicUrl, codocs.basePath)
      if (homeUrl) return normalizeCodocsHomeUrl(homeUrl, event)
    }
  } catch {
    // Console runtime 不可用时回退到显式配置。
  }

  const { codocsUrl } = getCodocsConfig()
  return normalizeCodocsHomeUrl(codocsUrl, event)
}

async function getCodocsServiceApiRoot(event?: H3Event) {
  const homeUrl = await getCodocsHomeUrl(event)
  return `${trimTrailingSlash(homeUrl)}/api/v1`
}

export async function getCodocsHomeOrigin() {
  return getCodocsHomeUrl()
}

/**
 * 直连 codocs 独立服务地址时没有 tenant gateway 注入上下文，必须由本应用转发入站请求的
 * 网关/租户/部署/runtime 上下文头，codocs 才能完成鉴权并调用自身 tenant-runtime/data-runtime。
 * 与 aims→altoc / aims→people 的服务端调用保持一致；缺失这些头会导致 codocs 返回 401。
 */
function forwardedCodocsContextHeaders(event?: H3Event): Record<string, string> {
  if (!event) return {}
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
    const value = stringValue(getHeader(event, name))
    if (value) headers[name] = value
  }
  const requestId = stringValue(getHeader(event, 'x-request-id') || getHeader(event, 'x-correlation-id'))
  if (requestId) headers['x-request-id'] = requestId
  return headers
}

type CodocsServiceScope
  = 'codocs:documents:read'
    | 'codocs:documents:write'
    | 'codocs:department-documents:list'
    | 'codocs:project-document:content:read'
    | 'codocs:project-cabinet:read'
    | 'codocs:project-cabinet:upload'
    | 'codocs:project-cabinet:delete'

async function getAuthHeaders(scope: CodocsServiceScope, event?: H3Event) {
  const token = await requestServiceAccessToken({
    audience: 'codocs',
    scope,
    event
  })
  return {
    Authorization: `Bearer ${token}`,
    ...forwardedCodocsContextHeaders(event)
  }
}

async function projectDocumentAuthHeaders(scope: CodocsServiceScope, event?: H3Event) {
  if (event && resolveTrustedTenantGatewayContext(event) && !resolveTrustedServiceAppRoute(event, 'codocs')) {
    throw createError({ statusCode: 503, message: 'Codocs 目标部署不可用' })
  }
  const token = await requestServiceAccessToken({ audience: 'codocs', scope, event })
  return { Authorization: `Bearer ${token}`, ...trustedServiceRequestHeaders(event, 'codocs') }
}

function getUserCookieHeader(uid: string) {
  return { cookie: `auth_user=${encodeURIComponent(uid)}` }
}

function cabinetUploadSuccessItem(response: CabinetUploadResponse): CabinetUploadItem | null {
  return response.items.find(uploaded => uploaded.status === 'success' && uploaded.uuid && uploaded.ossPath) || null
}

function cabinetUploadFailureMessage(response: CabinetUploadResponse, fallback: string) {
  const failed = response.items.find(uploaded => uploaded.status === 'error')
  return failed?.message || fallback
}

function throwCodocsUploadError(error: unknown, fallback: string): never {
  throwCodocsServiceError(error, fallback)
}

function throwCodocsServiceError(error: unknown, fallback: string): never {
  const status = codocsUpstreamStatus(error)
  throw createError({
    statusCode: status >= 400 && status < 600 ? status : 500,
    message: codocsUpstreamMessage(error, fallback)
  })
}

/**
 * 在 Codocs 中创建文档，返回 codocs_uuid
 */
export async function createCodocsDocument(params: {
  event?: H3Event
  uuid: string
  title: string
  ownerUid: string
  content?: string
  docType?: string
  deptCode?: string
  projectCode?: string
  folderPath?: string
}): Promise<void> {
  if ((params.docType || 'project') === 'project') {
    const result = await callCodocsProjectAccess<{ code: number, data: { uuid: string } }>(params.event, 'create', {
      documentUuid: params.uuid, actorUid: params.ownerUid, title: params.title, content: params.content || '',
      projectCode: params.projectCode, deptCode: params.deptCode, folderPath: params.folderPath
    })
    if (result.code !== 0 || result.data?.uuid !== params.uuid) throw createError({ statusCode: 502, message: 'Codocs 文档创建响应无效' })
    return
  }
  const apiRoot = await getCodocsServiceApiRoot(params.event)

  const response = await serviceAppFetch<{ code?: number, success?: boolean, message?: string, data: { uuid: string } }>(
    params.event, 'codocs',
    `${apiRoot}/documents`,
    {
      method: 'POST',
      headers: { ...(await projectDocumentAuthHeaders('codocs:documents:write', params.event)), 'idempotency-key': params.uuid },
      body: {
        uuid: params.uuid,
        title: params.title,
        ownerUid: params.ownerUid,
        content: params.content || '',
        docType: params.docType || 'project',
        deptCode: params.deptCode || null,
        projectCode: params.projectCode || null,
        folderPath: params.folderPath || null
      },
      timeout: CODOCS_DOCUMENT_CREATE_TIMEOUT_MS
    }
  )

  if (response.code !== undefined && response.code !== 0) {
    throw new Error(response.message || 'Codocs document creation failed')
  }
  if (response.success === false) {
    throw new Error(response.message || 'Codocs document creation failed')
  }
  if (!response.data?.uuid || response.data.uuid !== params.uuid) {
    throw new Error(response.message || 'Codocs document creation response is invalid')
  }
}

export async function uploadCodocsDepartmentCabinetFile(params: {
  event?: H3Event
  ownerUid: string
  deptCode: string
  projectCode?: string
  fileName: string
  data: Uint8Array
  contentType?: string
}) {
  const homeUrl = await getCodocsHomeUrl(params.event)
  const formData = new FormData()
  const bytes = params.data instanceof Uint8Array ? params.data : new Uint8Array(params.data)
  const arrayBuffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(arrayBuffer).set(bytes)

  formData.append('owner_uid', params.ownerUid)
  formData.append('dept_code', params.deptCode)
  if (params.projectCode) {
    formData.append('project_code', params.projectCode)
  }
  formData.append('file', new Blob([arrayBuffer], { type: params.contentType || 'application/octet-stream' }), params.fileName)

  const response = await $fetch<CabinetUploadResponse, string>(`${homeUrl}/api/dept-cabinet/upload`, {
    method: 'POST',
    headers: {
      ...(await getAuthHeaders('codocs:documents:write', params.event)),
      ...getUserCookieHeader(params.ownerUid)
    },
    body: formData,
    timeout: 300000
  })

  const item = cabinetUploadSuccessItem(response)
  if (!item) throw new Error(cabinetUploadFailureMessage(response, 'Codocs 文件柜上传失败'))
  return item
}

export async function uploadCodocsProjectCabinetFile(params: {
  event?: H3Event
  ownerUid: string
  projectCode: string
  deptCode?: string
  fileName: string
  data: Uint8Array
  contentType?: string
  fileUuid?: string
}) {
  const apiRoot = await getCodocsServiceApiRoot(params.event)
  const formData = new FormData()
  const bytes = params.data instanceof Uint8Array ? params.data : new Uint8Array(params.data)
  const arrayBuffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(arrayBuffer).set(bytes)

  formData.append('owner_uid', params.ownerUid)
  if (params.fileUuid) formData.append('document_uuid', params.fileUuid)
  formData.append('project_code', params.projectCode)
  if (params.deptCode) {
    formData.append('dept_code', params.deptCode)
  }
  formData.append('file', new Blob([arrayBuffer], { type: params.contentType || 'application/octet-stream' }), params.fileName)

  try {
    const response = await serviceAppFetch<CabinetUploadResponse>(params.event, 'codocs', `${apiRoot}/project-cabinet/upload`, {
      method: 'POST',
      headers: { ...(await projectDocumentAuthHeaders('codocs:project-cabinet:upload', params.event)), ...(params.fileUuid ? { 'idempotency-key': params.fileUuid } : {}) },
      body: formData,
      timeout: 300000
    })

    const item = cabinetUploadSuccessItem(response)
    if (item) return item

    throw new Error(cabinetUploadFailureMessage(response, 'Codocs 项目文件柜上传失败'))
  } catch (error) {
    throwCodocsUploadError(error, 'Codocs 项目文件柜上传失败')
  }
}

export async function getCodocsProjectCabinetDownloadUrl(params: {
  event?: H3Event
  fileUuid: string
  projectCode: string
  expectedOssPath?: string
}) {
  const apiRoot = await getCodocsServiceApiRoot(params.event)
  const query = new URLSearchParams({ project_code: params.projectCode, ...(params.expectedOssPath ? { expected_oss_path: params.expectedOssPath } : {}) })
  const response = await serviceAppFetch<CabinetDownloadUrlResponse>(
    params.event, 'codocs', `${apiRoot}/project-cabinet/${encodeURIComponent(params.fileUuid)}/download-url?${query}`,
    {
      method: 'GET',
      headers: await projectDocumentAuthHeaders('codocs:project-cabinet:read', params.event),
      timeout: CODOCS_CONTENT_TIMEOUT_MS
    }
  )

  if (response.code !== undefined && response.code !== 0) {
    throw new Error(response.message || 'Codocs 项目文件柜下载地址生成失败')
  }
  if (!response.data?.url) {
    throw new Error(response.message || 'Codocs 项目文件柜下载地址响应无效')
  }
  return {
    ...response.data,
    url: response.data.url
  }
}

export async function getCodocsProjectCabinetPreviewUrl(params: {
  event?: H3Event
  fileUuid: string
  projectCode: string
  expectedOssPath?: string
}) {
  const apiRoot = await getCodocsServiceApiRoot(params.event)
  const query = new URLSearchParams({ project_code: params.projectCode, ...(params.expectedOssPath ? { expected_oss_path: params.expectedOssPath } : {}) })
  const response = await serviceAppFetch<CabinetPreviewUrlResponse>(
    params.event, 'codocs', `${apiRoot}/project-cabinet/${encodeURIComponent(params.fileUuid)}/preview-url?${query}`,
    {
      method: 'GET',
      headers: await projectDocumentAuthHeaders('codocs:project-cabinet:read', params.event),
      timeout: CODOCS_CONTENT_TIMEOUT_MS
    }
  )

  if (response.code !== undefined && response.code !== 0) {
    throw new Error(response.message || 'Codocs 项目文件柜预览地址生成失败')
  }
  if (!response.data) {
    throw new Error(response.message || 'Codocs 项目文件柜预览地址响应无效')
  }
  return response.data
}

export async function deleteCodocsProjectCabinetFile(params: {
  event?: H3Event
  fileUuid: string
  projectCode: string
  expectedOssPath?: string
}) {
  const apiRoot = await getCodocsServiceApiRoot(params.event)
  try {
    const response = await serviceAppFetch<CabinetDeleteResponse>(
      params.event, 'codocs', `${apiRoot}/project-cabinet/${encodeURIComponent(params.fileUuid)}`,
      {
        method: 'DELETE',
        headers: { ...(await projectDocumentAuthHeaders('codocs:project-cabinet:delete', params.event)), 'idempotency-key': `delete:${params.fileUuid}` },
        body: {
          project_code: params.projectCode,
          ...(params.expectedOssPath ? { expected_oss_path: params.expectedOssPath } : {})
        },
        timeout: CODOCS_CONTENT_TIMEOUT_MS
      }
    )

    if (response.code !== undefined && response.code !== 0) {
      throw new Error(response.message || 'Codocs 项目文件柜删除失败')
    }
    return response.data || {}
  } catch (error) {
    throwCodocsServiceError(error, 'Codocs 项目文件柜删除失败')
  }
}

export async function searchDepartmentDocuments(params: {
  event?: H3Event
  deptCode: string
  actorUid: string
  pageSize?: number
}) {
  if (!params.event) {
    throw createError({ statusCode: 503, message: '部门文档服务命令缺少请求上下文' })
  }

  const actorUid = stringValue(params.actorUid)
  const deptCode = stringValue(params.deptCode)
  const pageSize = Math.min(params.pageSize || 100, 200)
  if (!actorUid || !deptCode) {
    throw createError({ statusCode: 400, message: '部门文档读取上下文不完整' })
  }

  const command = { actorUid, deptCode, pageSize, action: 'list' }
  const commandSha256 = await hashServiceCommandPayload(command)
  const serviceCommand = {
    operationId: `aims.codocs.department-documents.list:${commandSha256.slice(0, 24)}`,
    targetApp: 'codocs',
    operationCode: 'aims.codocs.department-documents.list.v1',
    requiredCapability: 'codocs:department-documents:list',
    idempotencyKey: `aims:codocs:department-documents:${commandSha256.slice(0, 32)}`,
    commandSchemaVersion: 'aims.codocs.department-documents.list.v1',
    commandSha256,
    command
  }
  const apiRoot = await getCodocsServiceApiRoot(params.event)
  const url = `${apiRoot}/service/department-documents/search`
  const requestTarget = new URL(url).pathname
  const sourceAuth = params.event.context.consoleAuth as { tenant?: unknown, deployment?: unknown } | undefined
  const gateway = resolveTrustedTenantGatewayContext(params.event)
  const tenantCode = stringValue(gateway?.tenant || sourceAuth?.tenant)
  const sourceDeploymentCode = stringValue(gateway?.deployment || sourceAuth?.deployment)
  const targetRoute = resolveTrustedServiceAppRoute(params.event, 'codocs')
  if (gateway && !targetRoute) {
    throw createError({ statusCode: 503, message: 'Codocs 可信服务路由不可用' })
  }
  const targetDeploymentCode = stringValue(targetRoute?.deploymentCode || sourceDeploymentCode)
  if (!tenantCode || !sourceDeploymentCode || !targetDeploymentCode) {
    throw createError({ statusCode: 503, message: '部门文档服务命令缺少租户上下文' })
  }

  const requestId = stringValue(getHeader(params.event, 'x-request-id') || getHeader(params.event, 'x-correlation-id')) || crypto.randomUUID()
  const token = await requestServiceAccessToken({
    audience: 'codocs',
    scope: 'codocs:department-documents:list',
    event: params.event
  })
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

  return await $fetch<{
    code: number
    data: {
      folders: CodocsFolderItem[]
      items: Array<{
        uuid: string
        title: string
        docType: string
        ownerUid: string
        deptCode: string | null
        projectCode: string | null
        folderId: number | null
        folderName: string | null
        contentSize: number
        aiAbstract: string | null
        updatedAt: string
      }>
    }
  }, string>(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'x-request-id': requestId,
      ...forwardedCodocsContextHeaders(params.event),
      ...(targetRoute ? trustedServiceRequestHeaders(params.event, 'codocs') : {}),
      'x-hzy-tenant': tenantCode,
      'x-hzy-deployment': targetDeploymentCode,
      ...signedHeaders
    },
    body: { serviceCommand },
    timeout: CODOCS_SUMMARY_TIMEOUT_MS
  })
}

export async function searchProjectDocuments(params: {
  event?: H3Event
  projectCode: string
  actorUid: string
  pageSize?: number
}) {
  const { event, ...payload } = params
  return await callCodocsProjectAccess<{ code: number, data: { folders: CodocsFolderItem[], items: Array<{ uuid: string, title: string, docType: string, ownerUid: string, deptCode: string | null, projectCode: string | null, folderId: number | null, folderName: string | null, contentSize: number, aiAbstract: string | null, updatedAt: string }> } }>(event, 'search', payload)
}

export async function getCodocsDocumentSummary(uuid: string, event?: H3Event) {
  const response = await callCodocsProjectAccess<{ code: number, data: CodocsDocumentMetadataRow }>(event, 'summary', { documentUuid: uuid })
  return normalizeCodocsDocumentSummary(response.data)
}

export async function getCodocsDocumentAccessPolicy(params: {
  event?: H3Event
  documentUuid: string
  documentRefType: 'codocs_document' | 'cabinet_file'
  sourceProjectCode?: string
  operatorUid?: string
}) {
  const { event, ...payload } = params
  const result = await callCodocsProjectAccess<{ code: number, data: DocumentAccessPolicy }>(event, 'policy-read', payload)
  return result.data
}

export async function updateCodocsDocumentAccessPolicy(params: {
  event?: H3Event
  documentUuid: string
  documentRefType: 'codocs_document' | 'cabinet_file'
  sourceApp?: string
  sourceProjectCode: string
  lifecycleStage: 'draft' | 'formal' | 'archived'
  confidentialityLevel: 'L0' | 'L1' | 'L2' | 'L3'
  defaultPermission: 'none' | 'view' | 'download'
  allowInternalAccess: boolean
  allowCrossProject: boolean
  readonly?: boolean
  grants: DocumentAccessGrantInput[]
  operatorUid: string
}) {
  const { event, ...payload } = params
  const result = await callCodocsProjectAccess<{ code: number, data: DocumentAccessPolicy }>(event, 'policy-update', payload)
  return result.data
}

export async function checkCodocsDocumentAccess(params: {
  event?: H3Event
  documentUuid: string
  documentRefType: 'codocs_document' | 'cabinet_file'
  sourceApp?: string
  sourceProjectCode: string
  action: 'view' | 'download' | 'edit'
  actorUid: string
  actorProjectCodes?: string[]
  actorDeptCodes?: string[]
  actorRoles?: string[]
}) {
  const { event, action: accessAction, ...payload } = params
  const result = await callCodocsProjectAccess<{ code: number, data: DocumentAccessCheckResult }>(event, 'check', { ...payload, accessAction })
  return result.data
}

export async function ensureCodocsDocumentPreviewAccess(params: {
  event?: H3Event
  documentUuid: string
  actorUid: string
  sourceProjectCode: string
}) {
  const body = {
    actorUid: params.actorUid,
    sourceApp: 'aims',
    sourceProjectCode: params.sourceProjectCode
  }

  // This operation must traverse the Codocs service API. Direct tenant-runtime
  // calls bypass Codocs' source-app and future signed-command verification.
  const apiRoot = await getCodocsServiceApiRoot(params.event)
  const response = await $fetch<{ code: number, data: Record<string, unknown> }, string>(
    `${apiRoot}/documents/${encodeURIComponent(params.documentUuid)}/preview-access`,
    {
      method: 'POST',
      headers: await getAuthHeaders('codocs:documents:write', params.event),
      body,
      timeout: 10000
    }
  )
  return response.data
}

export async function listCodocsDocumentAccessAuditLogs(params: {
  event?: H3Event
  documentUuid: string
  documentRefType: 'codocs_document' | 'cabinet_file'
  sourceProjectCode?: string
  page?: number
  pageSize?: number
}) {
  const { event, ...payload } = params
  const result = await callCodocsProjectAccess<{ code: number, data: DocumentAccessAuditListResult }>(event, 'audit', payload)
  return result.data
}

/**
 * 获取某个项目组（Account git_projects 的 project_code）下的所有文档
 * 桥接 Codocs 的 /api/documents/project/:projectCode 内部接口
 */
export async function listCodocsProjectGroupDocuments(projectCode: string, actorUid: string) {
  const apiRoot = await getCodocsApiRoot()

  return $fetch<{
    success: boolean
    data: Array<{
      id: number
      uuid: string
      nodeId: string
      parentId: number | null
      name: string
      data: {
        id: number
        uuid: string
        title: string
        doc_type: string
        oss_path: string
        owner_uid: string
        dept_code: string | null
        project_code: string | null
        folder_id: number | null
        content_size: number
        last_editor_uid: string | null
        created_at: string
        updated_at: string
      }
    }>
  }, string>(`${apiRoot}/documents/project/${encodeURIComponent(projectCode)}`, {
    headers: getUserCookieHeader(actorUid),
    timeout: 10000
  })
}

/**
 * 获取文档完整内容（Markdown 原文）
 * 通过 API Key 调用 Codocs 公共接口 /api/v1/documents/:uuid/content
 * 不做用户级权限校验——调用方（aims 需求分解）自行保证权限合法
 *
 * 第二个参数 actorUid 保留用于向后兼容，不再使用
 */
export async function getCodocsDocumentContent(uuid: string, _actorUid?: string, event?: H3Event) {
  const apiRoot = await getCodocsServiceApiRoot(event)

  const res = await $fetch<CodocsDocumentContentResponse, string>(`${apiRoot}/documents/${uuid}/content`, {
    headers: await getAuthHeaders('codocs:documents:read', event),
    timeout: CODOCS_CONTENT_TIMEOUT_MS
  })
  const rootDoc = res as CodocsDocumentContentData
  const doc = res.data || (rootDoc.uuid ? rootDoc : null)
  if (!doc) {
    throw createError({
      statusCode: res.code !== undefined && res.code !== 0 ? 502 : 404,
      message: res.message || '文档不存在或无法访问'
    })
  }

  // 以原先约定的外观对齐，降低调用方改动
  return {
    success: res.code === 0 || res.success === true,
    data: {
      uuid: doc.uuid || uuid,
      title: doc.title || '',
      doc_type: doc.docType ?? doc.doc_type ?? '',
      owner_uid: doc.ownerUid ?? doc.owner_uid ?? '',
      content: doc.content || '',
      updated_at: doc.updatedAt ?? doc.updated_at ?? ''
    }
  }
}

/**
 * Read one Aims-bound project document through the source-bound service
 * command. This is deliberately separate from the retired generic content
 * API: Aims must first prove the browser actor's project membership and exact
 * Aims document/deliverable binding, while Codocs re-checks its own ACL.
 */
export async function getCodocsProjectDocumentContent(params: {
  event: H3Event
  actorUid: string
  projectCode: string
  documentUuid: string
  // ADR-018：统一企业宿主以自己的身份调用，不借 aims.runtime。
  // codocs 侧有与 Aims 并列的 enterprise 授权条目，scope 与 operationCode 相同。
  sourceApp?: 'aims' | 'enterprise'
}) {
  const actorUid = stringValue(params.actorUid)
  const projectCode = stringValue(params.projectCode)
  const documentUuid = stringValue(params.documentUuid)
  if (!actorUid || !projectCode || !documentUuid) {
    throw createError({ statusCode: 400, message: '项目文档读取上下文不完整' })
  }
  const sourceApp = params.sourceApp === 'enterprise' ? 'enterprise' : 'aims'

  const command = {
    actorUid,
    projectCode,
    documentUuid,
    action: 'content:read'
  }
  const commandSha256 = await hashServiceCommandPayload(command)
  const serviceCommand = {
    operationId: `aims.codocs.project-document.content:${commandSha256.slice(0, 24)}`,
    targetApp: 'codocs',
    operationCode: 'aims.codocs.project-document.content-read.v1',
    requiredCapability: 'codocs:project-document:content:read',
    idempotencyKey: `aims:codocs:project-document:${commandSha256.slice(0, 32)}`,
    commandSchemaVersion: 'aims.codocs.project-document.content.v1',
    commandSha256,
    command
  }
  const apiRoot = await getCodocsServiceApiRoot(params.event)
  const url = `${apiRoot}/service/project-documents/${encodeURIComponent(documentUuid)}/content`
  const requestTarget = new URL(url).pathname
  const sourceAuth = params.event.context.consoleAuth as {
    tenant?: unknown
    deployment?: unknown
  } | undefined
  const gateway = resolveTrustedTenantGatewayContext(params.event)
  const tenantCode = stringValue(gateway?.tenant || sourceAuth?.tenant)
  const deploymentCode = stringValue(gateway?.deployment || sourceAuth?.deployment)
  // 来源与目标 deployment 必须分别解析（与部门文档、公司周报同款）：经受信网关
  // 到达 Codocs 时 `x-hzy-deployment` 是目标部署，把来源值当成目标会让签名与
  // Codocs 侧的跨应用绑定同时对不上。
  const targetRoute = resolveTrustedServiceAppRoute(params.event, 'codocs')
  if (gateway && !targetRoute) {
    throw createError({ statusCode: 503, message: 'Codocs 可信服务路由不可用' })
  }
  const targetDeploymentCode = stringValue(targetRoute?.deploymentCode || deploymentCode)
  if (!tenantCode || !deploymentCode || !targetDeploymentCode) {
    throw createError({ statusCode: 503, message: 'Aims project document command tenant context is unavailable.' })
  }
  const requestId = stringValue(getHeader(params.event, 'x-request-id') || getHeader(params.event, 'x-correlation-id')) || crypto.randomUUID()
  const token = await requestServiceAccessToken({
    audience: 'codocs',
    scope: 'codocs:project-document:content:read',
    event: params.event
  })
  const signedHeaders = await buildServiceCommandRuntimeHeaders({
    token,
    method: 'POST',
    requestTarget,
    requestId,
    tenantCode,
    sourceDeploymentCode: deploymentCode,
    targetDeploymentCode,
    sourceApp,
    // 来源应用与 source client 必须同源：codocs 的授权条目和 Runtime 合同
    // 都要求 client 精确等于 <sourceApp>.runtime，交叉组合会被拒。
    sourceClientId: `${sourceApp}.runtime`,
    targetApp: 'codocs',
    envelope: serviceCommand
  })
  const response = await serviceAppFetch<CodocsDocumentContentResponse>(
    params.event, 'codocs', url,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'x-request-id': requestId,
        ...forwardedCodocsContextHeaders(params.event),
        ...(targetRoute ? trustedServiceRequestHeaders(params.event, 'codocs') : {}),
        'x-hzy-tenant': tenantCode,
        'x-hzy-deployment': targetDeploymentCode,
        ...signedHeaders
      },
      body: { serviceCommand },
      timeout: CODOCS_CONTENT_TIMEOUT_MS
    }
  )
  const rootDoc = response as CodocsDocumentContentData
  const doc = response.data || (rootDoc.uuid ? rootDoc : null)
  if (!doc) {
    throw createError({
      statusCode: response.code !== undefined && response.code !== 0 ? 502 : 404,
      message: response.message || '文档不存在或无法访问'
    })
  }
  return {
    success: response.code === 0 || response.success === true,
    data: {
      uuid: doc.uuid || documentUuid,
      title: doc.title || '',
      doc_type: doc.docType ?? doc.doc_type ?? '',
      owner_uid: doc.ownerUid ?? doc.owner_uid ?? '',
      content: doc.content || '',
      updated_at: doc.updatedAt ?? doc.updated_at ?? ''
    }
  }
}

type CodocsQualityCommand = {
  actorUid: string
  documentUuid: string
  versionId: string
  action: string
  projectCode?: string
  submissionNo?: string
  roleCode?: string
  granteeRoleCode?: string
}

async function callCodocsProjectDocumentQualityService<T>(params: {
  event: H3Event
  scope: string
  operationCode: string
  commandSchemaVersion: string
  command: CodocsQualityCommand
  servicePath: string
  idempotencyKey: string
}) {
  const commandSha256 = await hashServiceCommandPayload(params.command)
  const serviceCommand = {
    operationId: `${params.operationCode}:${commandSha256.slice(0, 24)}`,
    targetApp: 'codocs',
    operationCode: params.operationCode,
    requiredCapability: params.scope,
    idempotencyKey: params.idempotencyKey,
    commandSchemaVersion: params.commandSchemaVersion,
    commandSha256,
    command: params.command
  }
  const apiRoot = await getCodocsServiceApiRoot(params.event)
  const url = `${apiRoot}${params.servicePath}`
  const requestTarget = new URL(url).pathname
  const sourceAuth = params.event.context.consoleAuth as { tenant?: unknown, deployment?: unknown } | undefined
  const gateway = resolveTrustedTenantGatewayContext(params.event)
  const tenantCode = stringValue(gateway?.tenant || sourceAuth?.tenant)
  const deploymentCode = stringValue(gateway?.deployment || sourceAuth?.deployment)
  if (!tenantCode || !deploymentCode) {
    throw createError({ statusCode: 503, message: 'Aims document quality command tenant context is unavailable.' })
  }
  const requestId = stringValue(getHeader(params.event, 'x-request-id') || getHeader(params.event, 'x-correlation-id')) || crypto.randomUUID()
  const token = await requestServiceAccessToken({
    audience: 'codocs',
    scope: params.scope,
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
    sourceApp: 'aims',
    sourceClientId: 'aims.runtime',
    targetApp: 'codocs',
    envelope: serviceCommand
  })
  const response = await $fetch<{ code?: number, success?: boolean, data?: T, message?: string }, string>(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'x-request-id': requestId,
      ...forwardedCodocsContextHeaders(params.event),
      'x-hzy-tenant': tenantCode,
      'x-hzy-deployment': deploymentCode,
      ...signedHeaders
    },
    body: { serviceCommand },
    timeout: CODOCS_CONTENT_TIMEOUT_MS
  })
  if (!response.data || (response.code !== undefined && response.code !== 0)) {
    throw createError({ statusCode: 502, message: response.message || 'Codocs document quality service returned an invalid response.' })
  }
  return response.data
}

export function resolveCodocsProjectDocumentVersion(params: {
  event: H3Event
  actorUid: string
  projectCode: string
  documentUuid: string
  versionId: number | string
}) {
  const versionId = String(params.versionId)
  return callCodocsProjectDocumentQualityService<{
    documentId: number
    documentUuid: string
    versionId: number
    versionNum: number
    title: string
    contentSha256: string
    createdAt: string
  }>({
    event: params.event,
    scope: 'codocs:project-document:version:resolve',
    operationCode: 'aims.codocs.project-document.version-resolve.v1',
    commandSchemaVersion: 'aims.codocs.project-document.version.resolve.v1',
    command: {
      actorUid: params.actorUid,
      projectCode: params.projectCode,
      documentUuid: params.documentUuid,
      versionId,
      action: 'version:resolve'
    },
    servicePath: `/service/project-documents/${encodeURIComponent(params.documentUuid)}/versions/${encodeURIComponent(versionId)}:resolve`,
    idempotencyKey: `aims:codocs:document-version:${params.documentUuid}:${versionId}:resolve:${params.actorUid}`
  })
}

export function createCodocsProjectDocumentReviewGrant(params: {
  event: H3Event
  actorUid: string
  documentUuid: string
  versionId: number | string
  submissionNo: string
  granteeRoleCode: 'qa' | 'project_director'
}) {
  const versionId = String(params.versionId)
  return callCodocsProjectDocumentQualityService<{
    grantId: number
    documentUuid: string
    versionId: number
    submissionNo: string
    granteeRoleCode: string
  }>({
    event: params.event,
    scope: 'codocs:project-document:review-grant:create',
    operationCode: 'aims.codocs.deliverable-review-grant.v1',
    commandSchemaVersion: 'aims.codocs.project-document.review-grant.v1',
    command: {
      actorUid: params.actorUid,
      documentUuid: params.documentUuid,
      versionId,
      submissionNo: params.submissionNo,
      granteeRoleCode: params.granteeRoleCode,
      action: 'review-grant:create'
    },
    servicePath: '/service/project-document-review-grants',
    idempotencyKey: `aims:deliverable-submission:${params.submissionNo}:review-grant:${params.granteeRoleCode}:v1`
  })
}

export function getCodocsProjectDocumentReviewContent(params: {
  event: H3Event
  actorUid: string
  documentUuid: string
  versionId: number | string
  submissionNo: string
  roleCode: 'qa' | 'project_director'
}) {
  const versionId = String(params.versionId)
  return callCodocsProjectDocumentQualityService<{
    documentUuid: string
    versionId: number
    versionNum: number
    title: string
    contentSize: number
    contentSha256: string
    content: string
  }>({
    event: params.event,
    scope: 'codocs:project-document:review-content:read',
    operationCode: 'aims.codocs.project-document.review-content.v1',
    commandSchemaVersion: 'aims.codocs.project-document.review-content.v1',
    command: {
      actorUid: params.actorUid,
      documentUuid: params.documentUuid,
      versionId,
      submissionNo: params.submissionNo,
      roleCode: params.roleCode,
      action: 'review-content:read'
    },
    servicePath: `/service/project-documents/${encodeURIComponent(params.documentUuid)}/versions/${encodeURIComponent(versionId)}/review-content`,
    idempotencyKey: `aims:deliverable-submission:${params.submissionNo}:review-content:${params.roleCode}:${params.actorUid}:v1`
  })
}
