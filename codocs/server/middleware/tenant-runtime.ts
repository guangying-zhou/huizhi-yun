import assetsProductDocumentMetadataService from '~~/server/utils/assetsProductDocumentMetadataService'
import productDocumentCreateService from '../utils/productDocumentCreateService'
import productDocumentContentService from '../utils/productDocumentContentService'
import productDocumentSearchService from '../utils/productDocumentSearchService'
import { projectDocumentAccessService } from '../utils/projectDocumentAccessService'
import { createError, getQuery, getRequestURL, readBody, type H3Event } from 'h3'
import { requireConsoleAuthContext } from '@hzy/foundation/server/utils/consoleOidc'
import { resolveConsoleAuthWithSessionBridge } from '@hzy/foundation/server/utils/consoleSessionBridge'
import { maybeCallCodocsTenantRuntime } from '~~/server/utils/codocsRuntime'
import { getRequestUid, requireRequestUid } from '~~/server/utils/authIdentity'
import { fetchDirectoryResponse } from '~~/server/utils/directoryCompat'
import { requirePermission } from '~~/server/utils/checkPermission'
import { requireDepartmentReadAccess } from '~~/server/utils/departmentAccess'
import { withTrustedCodocsDocumentReadContext } from '~~/server/utils/documentReadScope'
import {
  ALTOC_OPS_KNOWLEDGE_SERVICE_AUTH,
  requireCodocsServiceAuth
} from '~~/server/utils/serviceAuthGuard'

type RuntimeMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
type ResponseShape = 'successData' | 'successPage' | 'successItems' | 'codeData' | 'codePageItems' | 'codeShareArray' | 'successVersionArray'

interface RuntimeRoute {
  runtimePath: string
  shape: ResponseShape
}

interface RuntimePage {
  items?: unknown[]
  total?: number
  page?: number
  pageSize?: number
  limit?: number
}

interface ShareRow {
  shared_to_uid?: string
  [key: string]: unknown
}

interface DirectoryUser {
  uid: string
  realName?: string
  deptName?: string
}

const BLOCKED_LEGACY_ROUTES = [
  /^\/api\/admin\/cleanup-orphan-docs$/,
  /^\/api\/dingtalk\/sync-reports$/,
  /^\/api\/reviews\/[^/]+\/(?:approve|reject|remind|resubmit)$/,
  /^\/api\/reviews\/workflow-callback$/
]

export default defineEventHandler(async (event) => {
  const apiPath = currentApiPath(getRequestURL(event).pathname)
  if (!apiPath) return

  const method = normalizeMethod(event.node.req.method)
  await ensureConsoleAuthContext(event)
  if (apiPath === '/api/v1/service/project-document-access/execute') return await projectDocumentAccessService(event)
  const assetsDocumentMatch = /^\/api\/v1\/service\/assets-product-documents\/([^/]+)\/metadata$/.exec(apiPath)
  if (assetsDocumentMatch) {
    if (method !== 'POST') throw createError({ statusCode: 405, message: 'POST required' })
    event.context.params = { ...event.context.params, uuid: assetsDocumentMatch[1]! }
    return assetsProductDocumentMetadataService(event)
  }
  if (/^\/api\/v1\/service\/product-documents\/[^/]+\/content$/.test(apiPath)) {
    return productDocumentContentService(event)
  }
  if (apiPath === '/api/v1/service/product-documents/create') return productDocumentCreateService(event)
  if (apiPath === '/api/v1/service/product-documents/search') {
    if (method !== 'POST') throw createError({ statusCode: 405, message: 'POST required' })
    return productDocumentSearchService(event)
  }

  // This source-bound command has its own BFF boundary. It must authenticate
  // the incoming Aims token and bind tenant/deployment before it reads the
  // body; generic service forwarding would read and proxy the body too early.
  if (
    method === 'POST'
    && /^\/api\/v1\/service\/(?:product-documents\/[^/]+\/metadata|department-documents\/search|project-documents\/[^/]+\/(?:content|versions\/[^/]+(?::resolve|\/review-content))|project-document-review-grants|altoc-entity-documents\/[^/]+\/(?:content|attach)|company-weekly-summaries\/[^/]+:publish)$/.test(apiPath)
  ) return

  const route = resolveRuntimeRoute(apiPath, method)
  if (route) {
    await requireRuntimeRoutePermission(event, apiPath, method)
    await requireForwardedServiceCapability(event, apiPath, method)

    const actorUid = getRequestUid(event)
    const query = withCurrentUser(getQuery(event) as Record<string, unknown>, actorUid)
    const runtimeQuery = isDocumentListOrTrashRoute(apiPath, method)
      ? await documentReadRuntimeQuery(event)
      : isFolderListRoute(apiPath, method)
        ? await folderReadRuntimeQuery(event)
        : query
    const rawBody = method === 'GET' ? undefined : await readBody(event)
    const requestBody = objectBody(rawBody)
    const trustedBody = apiPath === '/api/v1/service/ops-knowledge/link'
      ? { ...requestBody, sourceApp: 'altoc', source_app: 'altoc' }
      : requestBody
    const body = method === 'GET' ? undefined : withCurrentUser(trustedBody, actorUid)
    const runtime = await maybeCallCodocsTenantRuntime<unknown>(event, route.runtimePath, {
      method,
      query: runtimeQuery,
      body,
      scope: method === 'GET' ? 'codocs.read' : 'codocs.write'
    })

    if (!runtime.handled) {
      throw createError({
        statusCode: 503,
        message: 'Codocs tenant-runtime is required for Codocs data access.'
      })
    }

    return await shapeRuntimeResponse(route.shape, runtime.data)
  }

  if (isCodocsServiceApiPath(apiPath)) {
    throw createError({
      statusCode: 403,
      message: 'Unsupported Codocs service endpoint capability.'
    })
  }

  if (isRuntimeBackedBffPath(apiPath, method)) return

  if (isBlockedLegacyCodocsPath(apiPath)) {
    throw createError({
      statusCode: 503,
      message: 'Codocs tenant-runtime contract is required for this legacy data endpoint.'
    })
  }
})

async function ensureConsoleAuthContext(event: H3Event) {
  const existing = event.context.consoleAuth as { authenticated?: unknown, reason?: unknown } | undefined
  if (existing && ('authenticated' in existing || 'reason' in existing)) return

  event.context.consoleAuth = await resolveConsoleAuthWithSessionBridge(event)
}

function currentApiPath(pathname: string) {
  const index = pathname.indexOf('/api')
  if (index < 0) return ''
  return pathname.slice(index)
}

function normalizeMethod(value: unknown): RuntimeMethod {
  const method = String(value || 'GET').toUpperCase()
  if (method === 'POST' || method === 'PATCH' || method === 'PUT' || method === 'DELETE') return method
  return 'GET'
}

function withCurrentUser(value: Record<string, unknown>, uid: string) {
  const result: Record<string, unknown> = { ...value }
  for (const key of ['current_user', 'currentUser', 'operator_uid', 'operatorUid', 'actorUid', 'actor_uid']) {
    Reflect.deleteProperty(result, key)
  }
  if (!uid) return result
  return {
    ...result,
    current_user: uid,
    currentUser: uid,
    operator_uid: uid,
    operatorUid: uid,
    actorUid: uid,
    actor_uid: uid
  }
}

function isDocumentListOrTrashRoute(apiPath: string, method: RuntimeMethod) {
  return method === 'GET' && (apiPath === '/api/documents' || apiPath === '/api/documents/trash')
}

function isFolderListRoute(apiPath: string, method: RuntimeMethod) {
  return method === 'GET' && apiPath === '/api/folders'
}

async function documentReadRuntimeQuery(event: H3Event) {
  const actorUid = requireRequestUid(event)
  await requirePermission(event, 'documents', 'view', '缺少文档查看权限')

  const input = getQuery(event) as Record<string, unknown>
  const docType = String(input.type || '').trim()
  const deptCode = String(input.dept_code || input.deptCode || '').trim()
  if (docType === 'department' && !deptCode) {
    throw createError({ statusCode: 400, message: '部门文档查询必须指定 dept_code' })
  }
  if (deptCode) {
    await requireDepartmentReadAccess(event, actorUid, deptCode)
  }

  return withTrustedCodocsDocumentReadContext(input, actorUid, deptCode)
}

async function folderReadRuntimeQuery(event: H3Event) {
  const actorUid = requireRequestUid(event)
  await requirePermission(event, 'documents', 'view', '缺少文档目录查看权限')

  const input = getQuery(event) as Record<string, unknown>
  const folderType = String(input.folder_type || input.folderType || '').trim()
  const deptCode = String(input.dept_code || input.deptCode || '').trim()
  if (folderType === 'department' && !deptCode) {
    throw createError({ statusCode: 400, message: '部门文件夹查询必须指定 dept_code' })
  }
  if (deptCode) {
    await requireDepartmentReadAccess(event, actorUid, deptCode)
  }

  return withTrustedCodocsDocumentReadContext(input, actorUid, deptCode)
}

function objectBody(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  return {}
}

function isCodocsServiceApiPath(apiPath: string) {
  return apiPath === '/api/v1/service' || apiPath.startsWith('/api/v1/service/')
}

function resolveRuntimeRoute(apiPath: string, method: RuntimeMethod): RuntimeRoute | null {
  if (apiPath === '/api/v1/service/ops-knowledge/link' && method === 'POST') {
    return { runtimePath: '/v1/codocs/service/ops-knowledge/link', shape: 'codeData' }
  }

  const shareList = /^\/api\/documents\/([^/]+)\/shares$/.exec(apiPath)
  if (shareList && method === 'GET') {
    return { runtimePath: `/v1/codocs/documents/${encodeURIComponent(shareList[1]!)}/shares`, shape: 'codeShareArray' }
  }
  if (shareList && method === 'POST') {
    return { runtimePath: `/v1/codocs/documents/${encodeURIComponent(shareList[1]!)}/shares`, shape: 'codeData' }
  }

  const shareMutation = /^\/api\/documents\/([^/]+)\/shares\/([^/]+)$/.exec(apiPath)
  if (shareMutation && (method === 'PATCH' || method === 'DELETE')) {
    return {
      runtimePath: `/v1/codocs/documents/${encodeURIComponent(shareMutation[1]!)}/shares/${encodeURIComponent(shareMutation[2]!)}`,
      shape: 'codeData'
    }
  }

  const versionList = /^\/api\/documents\/([^/]+)\/versions$/.exec(apiPath)
  if (versionList && method === 'GET') {
    return { runtimePath: `/v1/codocs/documents/${encodeURIComponent(versionList[1]!)}/versions`, shape: 'successVersionArray' }
  }

  const versionMutation = /^\/api\/documents\/([^/]+)\/versions\/([^/]+)$/.exec(apiPath)
  if (versionMutation && method === 'DELETE') {
    return {
      runtimePath: `/v1/codocs/documents/${encodeURIComponent(versionMutation[1]!)}/versions/${encodeURIComponent(versionMutation[2]!)}`,
      shape: 'successData'
    }
  }

  const readRoute = /^\/api\/documents\/([^/]+)\/read$/.exec(apiPath)
  if (readRoute && method === 'POST') {
    return { runtimePath: `/v1/codocs/documents/${encodeURIComponent(readRoute[1]!)}/read`, shape: 'successData' }
  }

  if (apiPath === '/api/documents' && method === 'GET') {
    return { runtimePath: '/v1/codocs/documents', shape: 'successPage' }
  }

  if (apiPath === '/api/folders' && method === 'GET') {
    return { runtimePath: '/v1/codocs/folders', shape: 'successPage' }
  }
  const folderMutation = /^\/api\/folders\/([^/]+)$/.exec(apiPath)
  if (folderMutation && (method === 'PATCH' || method === 'DELETE')) {
    return { runtimePath: `/v1/codocs/folders/${encodeURIComponent(folderMutation[1]!)}`, shape: 'successData' }
  }

  const generic = genericRuntimeRoute(apiPath, method)
  if (generic) return generic

  if (isUnsupportedGenericCabinetFolderPath(apiPath)) {
    throw createError({
      statusCode: 503,
      message: 'Codocs tenant-runtime contract is required for cabinet folder access.'
    })
  }

  return null
}

interface ConsoleAuthContext {
  authenticated?: boolean
  tokenUse?: string
  subjectType?: string
  appCode?: string
  clientCode?: string
  scopes?: string[]
}

async function requireForwardedServiceCapability(event: H3Event, apiPath: string, method: RuntimeMethod) {
  if (apiPath !== '/api/v1/service/ops-knowledge/link' || method !== 'POST') return

  const auth = await requireConsoleAuthContext(event) as ConsoleAuthContext
  requireCodocsServiceAuth(auth, ALTOC_OPS_KNOWLEDGE_SERVICE_AUTH)
}

async function requireRuntimeRoutePermission(event: H3Event, apiPath: string, method: RuntimeMethod) {
  if (apiPath === '/api/v1/service/ops-knowledge/link') return

  if (/^\/api\/documents\/[^/]+\/annotations(?:\/.*)?$/.test(apiPath)) {
    if (method === 'GET') {
      await requirePermission(event, 'documents', 'view', '缺少文档批注查看权限')
    } else {
      await requirePermission(event, 'documents', 'edit', '缺少文档批注编辑权限')
    }
    return
  }

  if (apiPath === '/api/document-access/check' && method === 'POST') {
    await requirePermission(event, 'documents', 'view', '缺少文档访问校验权限')
    return
  }

  if (/^\/api\/document-access\/policies\/[^/]+$/.test(apiPath) && (method === 'GET' || method === 'PUT' || method === 'PATCH')) {
    await requirePermission(event, 'documents', 'admin', '仅文档空间管理员可维护访问策略')
    return
  }

  if (apiPath === '/api/document-access/audit-logs' && method === 'GET') {
    await requirePermission(event, 'documents', 'admin', '仅文档空间管理员可查看访问审计')
    return
  }

  if (/^\/api\/reviews\/\d+$/.test(apiPath) && method === 'GET') {
    await requirePermission(event, 'reviews', 'view', '缺少审阅查看权限')
    return
  }

  if (/^\/api\/documents\/[^/]+\/shares$/.test(apiPath) && method === 'POST') {
    await requirePermission(event, 'documents', 'edit', '缺少文档共享权限')
    return
  }

  if (/^\/api\/documents\/[^/]+\/shares$/.test(apiPath) && method === 'GET') {
    await requirePermission(event, 'documents', 'edit', '缺少文档共享查看权限')
    return
  }

  if (/^\/api\/documents\/[^/]+\/versions$/.test(apiPath) && method === 'GET') {
    await requirePermission(event, 'documents', 'view', '缺少文档版本查看权限')
    return
  }

  if (/^\/api\/documents\/[^/]+\/read$/.test(apiPath) && method === 'POST') {
    await requirePermission(event, 'documents', 'view', '缺少文档阅读权限')
    return
  }

  if (/^\/api\/documents\/[^/]+\/shares\/[^/]+$/.test(apiPath) && (method === 'PATCH' || method === 'DELETE')) {
    await requirePermission(event, 'documents', 'edit', '缺少文档共享管理权限')
    return
  }

  if (/^\/api\/documents\/[^/]+\/versions\/[^/]+$/.test(apiPath) && method === 'DELETE') {
    await requirePermission(event, 'documents', 'edit', '缺少文档版本管理权限')
    return
  }

  if (apiPath === '/api/folders' && method === 'GET') {
    await requirePermission(event, 'documents', 'view', '缺少文档目录查看权限')
    return
  }

  if (/^\/api\/folders\/[^/]+$/.test(apiPath) && (method === 'PATCH' || method === 'DELETE')) {
    await requirePermission(event, 'documents', 'edit', '缺少文档目录管理权限')
    return
  }

  if (/^\/api\/reviews\/publish-requests\/[^/]+$/.test(apiPath) && ['PATCH', 'DELETE'].includes(method)) {
    await requirePermission(event, 'reviews', 'submit', '缺少审阅提交权限')
  }
}

function genericRuntimeRoute(apiPath: string, method: RuntimeMethod): RuntimeRoute | null {
  // These table-shaped paths have only parent-bound BFF contracts. They must
  // never be added to the generic runtime mapping: the runtime rejects the
  // direct paths as contract_required because a generic request cannot prove
  // the document, annotation, or issue ACL required by the nested route.
  if (isScopedNestedResourceGenericPath(apiPath)) return null

  // These routes have local BFF handlers which establish the subject and/or
  // department-manager boundary before calling a scoped runtime endpoint.
  // Never let a generic table mapping pre-empt that orchestration.
  if (apiPath === '/api/dept-shares' || apiPath.startsWith('/api/dept-shares/')) return null
  if (apiPath === '/api/dept-cabinet/folders' || apiPath.startsWith('/api/dept-cabinet/folders/')) return null
  if (apiPath === '/api/reviews/publish-requests' && method === 'POST') return null
  // Browser cabinet reads must run through their local handlers. Those
  // handlers authenticate the session, enforce documents:view, bind personal
  // reads to the signed actor, and construct the target-bound department
  // marker before tenant-runtime is called. Do not let generic resource
  // forwarding bypass that scope construction.
  if (method === 'GET' && (
    apiPath === '/api/cabinet'
    || apiPath === '/api/dept-cabinet'
    || (
      /^\/api\/(?:dept-)?cabinet\/[^/]+$/.test(apiPath)
      && apiPath !== '/api/cabinet/folders'
      && apiPath !== '/api/dept-cabinet/folders'
    )
  )) return null

  const mappings: Array<{ prefix: string, runtimePrefix: string, listShape?: ResponseShape }> = [
    { prefix: '/api/cabinet', runtimePrefix: '/v1/codocs/cabinet', listShape: 'successItems' },
    { prefix: '/api/dept-cabinet', runtimePrefix: '/v1/codocs/dept-cabinet', listShape: 'successItems' }
  ]

  for (const mapping of mappings) {
    const suffix = pathSuffix(apiPath, mapping.prefix)
    if (suffix === null) continue
    if ((mapping.prefix === '/api/cabinet' || mapping.prefix === '/api/dept-cabinet') && isSingleSegmentSuffix(suffix) && (method === 'PATCH' || method === 'DELETE')) {
      continue
    }
    const runtimePath = `${mapping.runtimePrefix}${suffix}`
    if (method === 'GET' && suffix === '') {
      return { runtimePath, shape: mapping.listShape || 'successPage' }
    }
    if (method === 'GET' && isSingleSegmentSuffix(suffix)) {
      return { runtimePath, shape: 'successData' }
    }
    if (method === 'POST' && suffix === '') {
      return { runtimePath, shape: 'successData' }
    }
    if ((method === 'PATCH' || method === 'DELETE') && isSingleSegmentSuffix(suffix)) {
      return { runtimePath, shape: 'successData' }
    }
  }

  const reviewDetail = /^\/api\/reviews\/(\d+)$/.exec(apiPath)
  if (reviewDetail && method === 'GET') {
    return { runtimePath: `/v1/codocs/reviews/${encodeURIComponent(reviewDetail[1]!)}`, shape: 'successData' }
  }

  return null
}

function isScopedNestedResourceGenericPath(apiPath: string) {
  return [
    '/api/document-shares',
    '/api/document-versions',
    '/api/annotations',
    '/api/annotation-replies',
    '/api/issue-comments'
  ].some(prefix => apiPath === prefix || apiPath.startsWith(`${prefix}/`))
}

function isUnsupportedGenericCabinetFolderPath(apiPath: string) {
  return apiPath === '/api/cabinet/folders' || apiPath.startsWith('/api/cabinet/folders/')
}

function pathSuffix(pathname: string, prefix: string) {
  if (pathname === prefix) return ''
  if (pathname.startsWith(`${prefix}/`)) return pathname.slice(prefix.length)
  return null
}

function isSingleSegmentSuffix(suffix: string) {
  return /^\/[^/]+$/.test(suffix)
}

function isRuntimeBackedBffPath(apiPath: string, method: RuntimeMethod) {
  if (apiPath === '/api/published-asset-links' && method === 'POST') return true
  if (/^\/api\/published-asset-links\/[^/]+$/.test(apiPath) && method === 'GET') return true
  if (apiPath === '/api/document-access/check' && method === 'POST') return true
  if (/^\/api\/document-access\/policies\/[^/]+$/.test(apiPath) && (method === 'GET' || method === 'PUT' || method === 'PATCH')) return true
  if (apiPath === '/api/document-access/audit-logs' && method === 'GET') return true
  if (apiPath === '/api/documents' && method === 'POST') return true
  if (apiPath === '/api/documents/stats/my' && method === 'GET') return true
  if (apiPath === '/api/documents/upload' && method === 'POST') return true
  if (apiPath === '/api/folders' && method === 'POST') return true
  if (apiPath.startsWith('/api/documents/project/') && method === 'GET') return true
  if (apiPath.startsWith('/api/folders/list/') && method === 'GET') return true
  if (/^\/api\/documents\/[^/]+$/.test(apiPath) && method === 'GET') return true
  if (/^\/api\/documents\/[^/]+\/download$/.test(apiPath) && method === 'GET') return true
  if (/^\/api\/documents\/[^/]+$/.test(apiPath) && (method === 'PATCH' || method === 'PUT' || method === 'DELETE')) return true
  if (/^\/api\/documents\/[^/]+\/restore$/.test(apiPath) && method === 'POST') return true
  if (/^\/api\/documents\/[^/]+\/(?:copy|dept-shares|project-transfer|notify)$/.test(apiPath) && method === 'POST') return true
  if (/^\/api\/documents\/[^/]+\/annotations(?:\/.*)?$/.test(apiPath)) return true
  if (/^\/api\/(?:dept-)?cabinet\/upload$/.test(apiPath) && method === 'POST') return true
  if (/^\/api\/(?:dept-)?cabinet\/[^/]+$/.test(apiPath) && (method === 'PATCH' || method === 'DELETE')) return true
  if (/^\/api\/(?:dept-)?cabinet\/[^/]+\/(?:download|preview|converted-info|preview-html|preview-pptx)$/.test(apiPath) && method === 'GET') return true
  if (/^\/api\/(?:dept-)?cabinet\/[^/]+\/to-document$/.test(apiPath) && method === 'POST') return true
  if (apiPath === '/api/issues' && (method === 'GET' || method === 'POST')) return true
  if (apiPath === '/api/issues/pending-count' && method === 'GET') return true
  if (apiPath === '/api/issues/upload-image' && method === 'POST') return true
  if (/^\/api\/issues\/[^/]+$/.test(apiPath) && (method === 'GET' || method === 'PATCH' || method === 'DELETE')) return true
  if (/^\/api\/issues\/[^/]+\/comments$/.test(apiPath) && method === 'POST') return true
  if (apiPath === '/api/info/list' && method === 'GET') return true
  if (apiPath === '/api/info/management' && (method === 'GET' || method === 'PUT')) return true
  if (apiPath === '/api/info/recommend' && method === 'POST') return true
  if (apiPath === '/api/info/sync' && method === 'POST') return true
  if (/^\/api\/info\/[^/]+$/.test(apiPath) && (method === 'GET' || method === 'DELETE')) return true
  if (apiPath.startsWith('/api/worklogs/') && (method === 'GET' || method === 'POST')) return true
  if (apiPath.startsWith('/api/personal-weekly-reports/') && (method === 'GET' || method === 'POST')) return true
  if (apiPath.startsWith('/api/weekly-reports/') && (method === 'GET' || method === 'POST')) return true
  if (apiPath === '/api/collab-docs' && method === 'GET') return true
  if (apiPath === '/api/ai/abstract' && method === 'POST') return true
  if (apiPath === '/api/upload/image' && method === 'POST') return true
  if (apiPath.startsWith('/api/company-assets/') && (method === 'GET' || method === 'POST' || method === 'DELETE')) return true
  if (apiPath.startsWith('/api/dept-assets/') && (method === 'GET' || method === 'POST')) return true
  if (apiPath.startsWith('/api/project-docs/') && (method === 'GET' || method === 'POST')) return true
  if (apiPath === '/api/reviews/my' && method === 'GET') return true
  if (apiPath === '/api/reviews/publish-requests' && method === 'GET') return true
  if (apiPath === '/api/reviews' && method === 'POST') return true
  if (apiPath === '/api/reviews/authorization/instance-conflict-explain' && method === 'POST') return true
  if (/^\/api\/reviews\/by-document\/[^/]+$/.test(apiPath) && method === 'GET') return true
  if (apiPath === '/api/reviews/by-oss-path' && method === 'GET') return true
  if (/^\/api\/reviews\/[^/]+$/.test(apiPath) && method === 'GET') return true
  if (/^\/api\/reviews\/publish-requests\/[^/]+$/.test(apiPath) && method === 'GET') return true
  if (/^\/api\/reviews\/publish-requests\/[^/]+\/workflow-instance$/.test(apiPath) && method === 'POST') return true
  if (/^\/api\/reviews\/[^/]+\/(?:archive|receive|seal|send)$/.test(apiPath) && method === 'POST') return true
  if (apiPath === '/api/reviews/workflow-callback' && method === 'POST') return true
  if (apiPath === '/api/v1/documents' && method === 'POST') return true
  if (apiPath === '/api/v1/documents/search' && method === 'GET') return true
  if (apiPath === '/api/v1/documents/batch-summary' && method === 'POST') return true
  if (/^\/api\/v1\/documents\/[^/]+\/(content|summary|url)$/.test(apiPath) && method === 'GET') return true
  if (apiPath.startsWith('/api/v1/codocs/')) return true
  return false
}

function isBlockedLegacyCodocsPath(apiPath: string) {
  return BLOCKED_LEGACY_ROUTES.some(pattern => pattern.test(apiPath))
}

async function shapeRuntimeResponse(shape: ResponseShape, value: unknown) {
  if (shape === 'successData') return { success: true, data: value }
  if (shape === 'codeData') return { success: true, code: 0, message: 'success', data: value }
  if (shape === 'codePageItems') return { code: 0, message: 'success', data: itemsValue(value) }

  if (shape === 'successPage') {
    const page = pageValue(value)
    return {
      success: true,
      data: {
        items: page.items || [],
        total: Number(page.total || 0),
        page: Number(page.page || 1),
        limit: Number(page.limit || page.pageSize || 0),
        pageSize: Number(page.pageSize || page.limit || 0)
      }
    }
  }

  if (shape === 'successItems') {
    return {
      success: true,
      data: {
        items: itemsValue(value)
      }
    }
  }

  if (shape === 'codeShareArray') {
    return {
      code: 0,
      message: 'success',
      data: await enrichShares(itemsValue(value) as ShareRow[])
    }
  }

  if (shape === 'successVersionArray') {
    return {
      success: true,
      data: itemsValue(value).map(toVersionResponse)
    }
  }
}

function pageValue(value: unknown): RuntimePage {
  if (value && typeof value === 'object') return value as RuntimePage
  return {}
}

function itemsValue(value: unknown) {
  if (Array.isArray(value)) return value
  const page = pageValue(value)
  return Array.isArray(page.items) ? page.items : []
}

async function enrichShares(shares: ShareRow[]) {
  const uniqueUserIds = [...new Set(shares.map(s => String(s.shared_to_uid || '').trim()).filter(Boolean))]
  if (uniqueUserIds.length === 0) return shares

  const userMap: Record<string, DirectoryUser> = {}
  try {
    const response = await fetchDirectoryResponse<DirectoryUser[]>('/users/batch', {
      method: 'POST',
      body: { uids: uniqueUserIds }
    })
    for (const user of response.data || []) {
      userMap[user.uid] = user
    }
  } catch (error) {
    console.error('Failed to fetch users from Console Directory:', error)
  }

  return shares.map(share => ({
    ...share,
    real_name: userMap[String(share.shared_to_uid || '')]?.realName || share.shared_to_uid,
    department_name: userMap[String(share.shared_to_uid || '')]?.deptName || ''
  }))
}

function toVersionResponse(value: unknown) {
  const row = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const editorUid = String(row.editor_uid || row.editorUid || '')
  return {
    id: row.id,
    versionNum: row.version_num ?? row.versionNum,
    ossVersionId: row.oss_version_id ?? row.ossVersionId,
    editorUid,
    editorName: editorUid || '未知用户',
    editorAvatar: null,
    contentSize: row.content_size ?? row.contentSize,
    contentSha256: row.content_sha256 ?? row.contentSha256 ?? null,
    createdAt: row.created_at ?? row.createdAt
  }
}
