/**
 * Codocs API 客户端
 * 使用 Console service token 调用 Codocs 模块间接口
 */
import { buildAppHomeUrl, getRequestOrigin } from '@hzy/foundation/server/utils/appUrls'
import { getConsoleRuntimeConfig } from '@hzy/foundation/server/utils/consoleRuntime'
import { requestServiceAccessToken } from '@hzy/foundation/server/utils/serviceOidc'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { createError, type H3Event } from 'h3'

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

async function getCodocsApiRoot(event?: H3Event) {
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

async function getAuthHeaders(scope: 'codocs:documents:read' | 'codocs:documents:write', _event?: H3Event) {
  const token = await requestServiceAccessToken({
    audience: 'codocs',
    scope
  })
  return { Authorization: `Bearer ${token}` }
}

function getUserCookieHeader(uid: string) {
  return { cookie: `auth_user=${encodeURIComponent(uid)}` }
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
  uuid: string
  title: string
  ownerUid: string
  content?: string
  docType?: string
  deptCode?: string
  projectCode?: string
  folderPath?: string
}): Promise<void> {
  const apiRoot = await getCodocsApiRoot()

  const response = await $fetch<{ code?: number, success?: boolean, message?: string, data: { uuid: string } }>(
    `${apiRoot}/documents`,
    {
      method: 'POST',
      headers: await getAuthHeaders('codocs:documents:write'),
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
      timeout: 10000
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
  ownerUid: string
  deptCode: string
  projectCode?: string
  fileName: string
  data: Uint8Array
  contentType?: string
}) {
  const homeUrl = await getCodocsHomeUrl()
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

  const response = await $fetch<CabinetUploadResponse>(`${homeUrl}/api/dept-cabinet/upload`, {
    method: 'POST',
    headers: {
      ...(await getAuthHeaders('codocs:documents:write')),
      ...getUserCookieHeader(params.ownerUid)
    },
    body: formData,
    timeout: 300000
  })

  const item = response.items.find(uploaded => uploaded.status === 'success')
  if (!item?.uuid || !item.ossPath) {
    const failed = response.items.find(uploaded => uploaded.status === 'error')
    throw new Error(failed?.message || 'Codocs 文件柜上传失败')
  }

  return item
}

export async function searchDepartmentDocuments(params: {
  event?: H3Event
  deptCode: string
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
          folder_type: 'department',
          dept_code: params.deptCode,
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
          type: 'department',
          dept_code: params.deptCode,
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
    $fetch<CodocsFolderListResponse>(`${apiRoot}/folders`, {
      headers: getUserCookieHeader(params.actorUid),
      params: {
        folder_type: 'department',
        dept_code: params.deptCode,
        limit: pageSize,
        page: 1
      },
      timeout: 10000
    }),
    $fetch<CodocsDocumentListResponse>(`${apiRoot}/documents`, {
      headers: getUserCookieHeader(params.actorUid),
      params: {
        type: 'department',
        dept_code: params.deptCode,
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
    $fetch<CodocsFolderListResponse>(`${apiRoot}/folders`, {
      headers: getUserCookieHeader(params.actorUid),
      params: {
        folder_type: 'project',
        project_code: params.projectCode,
        limit: pageSize,
        page: 1
      },
      timeout: 10000
    }),
    $fetch<CodocsDocumentListResponse>(`${apiRoot}/documents`, {
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

  return $fetch<CodocsDocumentSummaryResponse>(`${apiRoot}/documents/${uuid}/summary`, {
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
  const response = await $fetch<{ code: number, data: DocumentAccessPolicy }>(
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
  const response = await $fetch<{ code: number, data: DocumentAccessPolicy }>(
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
  const body = {
    documentUuid: params.documentUuid,
    documentRefType: params.documentRefType,
    sourceApp: params.sourceApp || 'aims',
    sourceProjectCode: params.sourceProjectCode,
    action: params.action,
    actorUid: params.actorUid,
    actorProjectCodes: params.actorProjectCodes || [],
    actorDeptCodes: params.actorDeptCodes || [],
    actorRoles: params.actorRoles || []
  }
  const runtimeAccess = await maybeCallCodocsRuntime<DocumentAccessCheckResult>(
    params.event,
    '/v1/codocs/document-access/check',
    {
      method: 'POST',
      scope: 'codocs.read',
      body
    }
  )
  if (runtimeAccess) return runtimeAccess

  const apiRoot = await getCodocsApiRoot(params.event)
  const response = await $fetch<{ code: number, data: DocumentAccessCheckResult }>(
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
  sourceApp?: string
}) {
  const body = {
    actorUid: params.actorUid,
    sourceApp: params.sourceApp || 'aims',
    sourceProjectCode: params.sourceProjectCode
  }

  const runtimeAccess = await maybeCallCodocsRuntime<Record<string, unknown>>(
    params.event,
    `/v1/codocs/documents/${encodeURIComponent(params.documentUuid)}/relations/preview-access`,
    {
      method: 'POST',
      scope: 'codocs.write',
      body
    }
  )
  if (runtimeAccess) return runtimeAccess

  const apiRoot = await getCodocsServiceApiRoot(params.event)
  const response = await $fetch<{ code: number, data: Record<string, unknown> }>(
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
  const response = await $fetch<{ code: number, data: DocumentAccessAuditListResult }>(
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
  }>(`${apiRoot}/documents/project/${encodeURIComponent(projectCode)}`, {
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

  const res = await $fetch<CodocsDocumentContentResponse>(`${apiRoot}/documents/${uuid}/content`, {
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
