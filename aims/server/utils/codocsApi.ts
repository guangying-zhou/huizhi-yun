/**
 * Codocs API 客户端
 * 使用 Console service token 调用 Codocs 模块间接口
 */
import { buildAppHomeUrl, getRequestOrigin } from '@hzy/foundation/server/utils/appUrls'
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
  hashServiceCommandPayload,
  maybeCallTenantRuntime
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

interface CodocsFolderListResponse {
  success: boolean
  data: {
    items: CodocsFolderItem[]
    total: number
    page: number
    limit: number
  }
}

interface CodocsDocumentListResponse {
  success: boolean
  data: {
    items: Array<{
      id: number
      uuid: string
      title: string
      doc_type: string
      owner_uid: string
      dept_code: string | null
      project_code: string | null
      folder_id: number | null
      folder_name: string | null
      content_size: number
      updated_at: string
    }>
    total: number
    page: number
    limit: number
  }
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

interface CodocsRuntimePage<T> {
  items?: T[]
  total?: number
  page?: number
  pageSize?: number
  limit?: number
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

const AIMS_TRUSTED_DOCUMENT_ACCESS_PROJECT_CODES_QUERY = 'aims_trusted_document_access_project_codes'
const AIMS_TRUSTED_DOCUMENT_ACCESS_ROLES_QUERY = 'aims_trusted_document_access_roles'

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

interface RuntimeSuccessEnvelope<T> {
  success?: boolean
  data?: T
  code?: number
  message?: string
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

function unwrapRuntimeData<T>(value: unknown): T {
  if (value && typeof value === 'object' && 'data' in value) {
    const envelope = value as RuntimeSuccessEnvelope<T>
    if (envelope.code !== undefined && envelope.code !== 0) {
      throw createError({ statusCode: 502, message: envelope.message || 'Codocs tenant-runtime returned an error.' })
    }
    return envelope.data as T
  }
  return value as T
}

async function maybeCallCodocsRuntime<T>(
  event: H3Event | undefined,
  path: string,
  options: {
    method?: string
    query?: Record<string, unknown>
    body?: unknown
    scope?: string
  }
) {
  if (!event) return null
  const runtime = await maybeCallTenantRuntime<unknown>(event, path, {
    appCode: 'codocs',
    scope: options.scope || (options.method && options.method !== 'GET' ? 'codocs.write' : 'codocs.read'),
    method: options.method || 'GET',
    query: options.query,
    body: options.body
  })
  if (!runtime.handled) return null
  return unwrapRuntimeData<T>(runtime.data)
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
  const apiRoot = await getCodocsServiceApiRoot(params.event)

  const response = await $fetch<{ code?: number, success?: boolean, message?: string, data: { uuid: string } }, string>(
    `${apiRoot}/documents`,
    {
      method: 'POST',
      headers: await getAuthHeaders('codocs:documents:write', params.event),
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
}) {
  const apiRoot = await getCodocsServiceApiRoot(params.event)
  const formData = new FormData()
  const bytes = params.data instanceof Uint8Array ? params.data : new Uint8Array(params.data)
  const arrayBuffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(arrayBuffer).set(bytes)

  formData.append('owner_uid', params.ownerUid)
  formData.append('project_code', params.projectCode)
  if (params.deptCode) {
    formData.append('dept_code', params.deptCode)
  }
  formData.append('file', new Blob([arrayBuffer], { type: params.contentType || 'application/octet-stream' }), params.fileName)

  try {
    const response = await $fetch<CabinetUploadResponse, string>(`${apiRoot}/project-cabinet/upload`, {
      method: 'POST',
      headers: await getAuthHeaders('codocs:project-cabinet:upload', params.event),
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
  const response = await $fetch<CabinetDownloadUrlResponse, string>(
    `${apiRoot}/project-cabinet/${encodeURIComponent(params.fileUuid)}/download-url`,
    {
      method: 'GET',
      headers: await getAuthHeaders('codocs:project-cabinet:read', params.event),
      query: {
        project_code: params.projectCode,
        ...(params.expectedOssPath ? { expected_oss_path: params.expectedOssPath } : {})
      },
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
  const response = await $fetch<CabinetPreviewUrlResponse, string>(
    `${apiRoot}/project-cabinet/${encodeURIComponent(params.fileUuid)}/preview-url`,
    {
      method: 'GET',
      headers: await getAuthHeaders('codocs:project-cabinet:read', params.event),
      query: {
        project_code: params.projectCode,
        ...(params.expectedOssPath ? { expected_oss_path: params.expectedOssPath } : {})
      },
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
    const response = await $fetch<CabinetDeleteResponse, string>(
      `${apiRoot}/project-cabinet/${encodeURIComponent(params.fileUuid)}`,
      {
        method: 'DELETE',
        headers: await getAuthHeaders('codocs:project-cabinet:delete', params.event),
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
  const pageSize = Math.min(params.pageSize || 100, 200)

  const [runtimeFolders, runtimeDocuments] = await Promise.all([
    maybeCallCodocsRuntime<CodocsRuntimePage<CodocsFolderItem>>(
      params.event,
      '/v1/codocs/folders',
      {
        query: {
          folder_type: 'project',
          project_code: params.projectCode,
          limit: pageSize,
          page: 1,
          current_user: params.actorUid,
          actorUid: params.actorUid
        },
        scope: 'codocs.read'
      }
    ),
    maybeCallCodocsRuntime<CodocsRuntimePage<CodocsDocumentListResponse['data']['items'][number]>>(
      params.event,
      '/v1/codocs/documents',
      {
        query: {
          type: 'project',
          project_code: params.projectCode,
          limit: pageSize,
          page: 1,
          current_user: params.actorUid,
          actorUid: params.actorUid
        },
        scope: 'codocs.read'
      }
    )
  ])

  if (runtimeFolders && runtimeDocuments) {
    return {
      code: 0,
      data: {
        folders: runtimeFolders.items || [],
        items: (runtimeDocuments.items || []).map(item => ({
          uuid: item.uuid,
          title: item.title,
          docType: item.doc_type,
          ownerUid: item.owner_uid,
          deptCode: item.dept_code,
          projectCode: item.project_code,
          folderId: item.folder_id,
          folderName: item.folder_name,
          contentSize: item.content_size,
          aiAbstract: null,
          updatedAt: item.updated_at
        }))
      }
    }
  }

  const apiRoot = await getCodocsApiRoot()

  const [foldersRes, documentsRes] = await Promise.all([
    $fetch<CodocsFolderListResponse, string>(`${apiRoot}/folders`, {
      headers: getUserCookieHeader(params.actorUid),
      params: {
        folder_type: 'project',
        project_code: params.projectCode,
        limit: pageSize,
        page: 1
      },
      timeout: 10000
    }),
    $fetch<CodocsDocumentListResponse, string>(`${apiRoot}/documents`, {
      headers: getUserCookieHeader(params.actorUid),
      params: {
        type: 'project',
        project_code: params.projectCode,
        limit: pageSize,
        page: 1
      },
      timeout: 10000
    })
  ])

  return {
    code: 0,
    data: {
      folders: foldersRes.data?.items || [],
      items: (documentsRes.data?.items || []).map(item => ({
        uuid: item.uuid,
        title: item.title,
        docType: item.doc_type,
        ownerUid: item.owner_uid,
        deptCode: item.dept_code,
        projectCode: item.project_code,
        folderId: item.folder_id,
        folderName: item.folder_name,
        contentSize: item.content_size,
        aiAbstract: null,
        updatedAt: item.updated_at
      }))
    }
  }
}

export async function getCodocsDocumentSummary(uuid: string, event?: H3Event) {
  const runtimeSummary = await maybeCallCodocsRuntime<CodocsDocumentMetadataRow>(
    event,
    `/v1/codocs/documents/${encodeURIComponent(uuid)}`,
    {
      scope: 'codocs.read'
    }
  )
  if (runtimeSummary) {
    return normalizeCodocsDocumentSummary(runtimeSummary)
  }

  const apiRoot = await getCodocsServiceApiRoot(event)

  return $fetch<CodocsDocumentSummaryResponse, string>(`${apiRoot}/documents/${uuid}/summary`, {
    headers: await getAuthHeaders('codocs:documents:read', event),
    timeout: CODOCS_SUMMARY_TIMEOUT_MS
  })
}

export async function getCodocsDocumentAccessPolicy(params: {
  event?: H3Event
  documentUuid: string
  documentRefType: 'codocs_document' | 'cabinet_file'
  sourceProjectCode?: string
  operatorUid?: string
}) {
  const runtimePolicy = await maybeCallCodocsRuntime<DocumentAccessPolicy>(
    params.event,
    `/v1/codocs/document-access/policies/${encodeURIComponent(params.documentUuid)}`,
    {
      query: {
        documentRefType: params.documentRefType,
        sourceProjectCode: params.sourceProjectCode,
        operator_uid: params.operatorUid
      },
      scope: 'codocs.read'
    }
  )
  if (runtimePolicy) return runtimePolicy

  const apiRoot = await getCodocsApiRoot(params.event)
  const response = await $fetch<{ code: number, data: DocumentAccessPolicy }, string>(
    `${apiRoot}/document-access/policies/${encodeURIComponent(params.documentUuid)}`,
    {
      headers: await getAuthHeaders('codocs:documents:read', params.event),
      params: {
        documentRefType: params.documentRefType,
        sourceProjectCode: params.sourceProjectCode,
        operator_uid: params.operatorUid
      },
      timeout: 10000
    }
  )
  return response.data
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
  const body = {
    documentRefType: params.documentRefType,
    sourceApp: params.sourceApp || 'aims',
    sourceProjectCode: params.sourceProjectCode,
    lifecycleStage: params.lifecycleStage,
    confidentialityLevel: params.confidentialityLevel,
    defaultPermission: params.defaultPermission,
    allowInternalAccess: params.allowInternalAccess,
    allowCrossProject: params.allowCrossProject,
    readonly: params.readonly,
    grants: params.grants,
    operatorUid: params.operatorUid
  }
  const runtimePolicy = await maybeCallCodocsRuntime<DocumentAccessPolicy>(
    params.event,
    `/v1/codocs/document-access/policies/${encodeURIComponent(params.documentUuid)}`,
    {
      method: 'PUT',
      scope: 'codocs.write',
      body
    }
  )
  if (runtimePolicy) return runtimePolicy

  const apiRoot = await getCodocsApiRoot(params.event)
  const response = await $fetch<{ code: number, data: DocumentAccessPolicy }, string>(
    `${apiRoot}/document-access/policies/${encodeURIComponent(params.documentUuid)}`,
    {
      method: 'PUT',
      headers: await getAuthHeaders('codocs:documents:write', params.event),
      body,
      timeout: 10000
    }
  )
  return response.data
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
  const actorProjectCodes = [...new Set((params.actorProjectCodes || []).map(stringValue).filter(Boolean))]
  const actorRoles = [...new Set((params.actorRoles || []).map(stringValue).filter(Boolean))]
  const body = {
    documentUuid: params.documentUuid,
    documentRefType: params.documentRefType,
    sourceApp: params.sourceApp || 'aims',
    sourceProjectCode: params.sourceProjectCode,
    action: params.action,
    actorUid: params.actorUid,
    actorProjectCodes,
    actorDeptCodes: params.actorDeptCodes || [],
    actorRoles
  }
  const runtimeAccess = await maybeCallCodocsRuntime<DocumentAccessCheckResult>(
    params.event,
    '/v1/codocs/document-access/check',
    {
      method: 'POST',
      scope: 'codocs.read',
      query: {
        [AIMS_TRUSTED_DOCUMENT_ACCESS_PROJECT_CODES_QUERY]: actorProjectCodes.join(','),
        [AIMS_TRUSTED_DOCUMENT_ACCESS_ROLES_QUERY]: actorRoles.join(',')
      },
      body
    }
  )
  if (runtimeAccess) return runtimeAccess

  const apiRoot = await getCodocsApiRoot(params.event)
  const response = await $fetch<{ code: number, data: DocumentAccessCheckResult }, string>(
    `${apiRoot}/document-access/check`,
    {
      method: 'POST',
      headers: await getAuthHeaders('codocs:documents:read', params.event),
      body,
      timeout: 10000
    }
  )
  return response.data
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
  const query = {
    documentUuid: params.documentUuid,
    documentRefType: params.documentRefType,
    sourceProjectCode: params.sourceProjectCode,
    page: params.page || 1,
    pageSize: params.pageSize || 20
  }
  const runtimeLogs = await maybeCallCodocsRuntime<DocumentAccessAuditListResult>(
    params.event,
    '/v1/codocs/document-access/audit-logs',
    {
      query,
      scope: 'codocs.read'
    }
  )
  if (runtimeLogs) return runtimeLogs

  const apiRoot = await getCodocsApiRoot(params.event)
  const response = await $fetch<{ code: number, data: DocumentAccessAuditListResult }, string>(
    `${apiRoot}/document-access/audit-logs`,
    {
      headers: await getAuthHeaders('codocs:documents:read', params.event),
      params: query,
      timeout: 10000
    }
  )
  return response.data
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
}) {
  const actorUid = stringValue(params.actorUid)
  const projectCode = stringValue(params.projectCode)
  const documentUuid = stringValue(params.documentUuid)
  if (!actorUid || !projectCode || !documentUuid) {
    throw createError({ statusCode: 400, message: '项目文档读取上下文不完整' })
  }

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
  if (!tenantCode || !deploymentCode) {
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
    targetDeploymentCode: deploymentCode,
    sourceApp: 'aims',
    sourceClientId: 'aims.runtime',
    targetApp: 'codocs',
    envelope: serviceCommand
  })
  const response = await $fetch<CodocsDocumentContentResponse, string>(
    url,
    {
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
