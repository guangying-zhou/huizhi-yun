import { createError, getQuery, getRequestURL, readBody, type H3Event } from 'h3'
import { requireConsoleAuthContext } from '@hzy/foundation/server/utils/consoleOidc'
import { maybeCallCodocsTenantRuntime } from '~~/server/utils/codocsRuntime'
import { getRequestUid } from '~~/server/utils/authIdentity'
import { fetchDirectoryResponse } from '~~/server/utils/directoryCompat'

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
  /^\/api\/reviews\/[^/]+\/(?:approve|archive|receive|reject|remind|resubmit|seal|send)$/,
  /^\/api\/reviews\/workflow-callback$/,
  /^\/api\/company-assets\/import-documents$/
]

export default defineEventHandler(async (event) => {
  const apiPath = currentApiPath(getRequestURL(event).pathname)
  if (!apiPath) return

  const method = normalizeMethod(event.node.req.method)
  const route = resolveRuntimeRoute(apiPath, method)
  if (route) {
    await requireForwardedServiceCapability(event, apiPath, method)

    const actorUid = getRequestUid(event)
    const query = withCurrentUser(getQuery(event) as Record<string, unknown>, actorUid)
    const rawBody = method === 'GET' ? undefined : await readBody(event)
    const body = method === 'GET' ? undefined : withCurrentUser(objectBody(rawBody), actorUid)
    const runtime = await maybeCallCodocsTenantRuntime<unknown>(event, route.runtimePath, {
      method,
      query,
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

  if (isRuntimeBackedBffPath(apiPath, method)) return

  if (isBlockedLegacyCodocsPath(apiPath)) {
    throw createError({
      statusCode: 503,
      message: 'Codocs tenant-runtime contract is required for this legacy data endpoint.'
    })
  }
})

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
  if (!uid) return value
  return {
    ...value,
    current_user: value.current_user ?? uid,
    operator_uid: value.operator_uid ?? uid,
    actorUid: value.actorUid ?? uid
  }
}

function objectBody(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  return {}
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
  if (apiPath === '/api/folders' && method === 'POST') {
    return { runtimePath: '/v1/codocs/folders', shape: 'successData' }
  }
  const folderMutation = /^\/api\/folders\/([^/]+)$/.exec(apiPath)
  if (folderMutation && (method === 'PATCH' || method === 'DELETE')) {
    return { runtimePath: `/v1/codocs/folders/${encodeURIComponent(folderMutation[1]!)}`, shape: 'successData' }
  }

  const generic = genericRuntimeRoute(apiPath, method)
  if (generic) return generic

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

function sourceApp(auth: ConsoleAuthContext) {
  return String(auth.appCode || auth.clientCode || '').trim().replace(/\.runtime$/, '')
}

function hasServiceCapability(scopes: string[], required: string) {
  const scopeSet = new Set(scopes)
  if (scopeSet.has(required)) return true
  return scopeSet.has('codocs:*') || scopeSet.has('codocs:admin')
}

async function requireForwardedServiceCapability(event: H3Event, apiPath: string, method: RuntimeMethod) {
  if (apiPath !== '/api/v1/service/ops-knowledge/link' || method !== 'POST') return

  const auth = await requireConsoleAuthContext(event) as ConsoleAuthContext
  if (!auth.authenticated || auth.tokenUse !== 'service' || auth.subjectType !== 'service') {
    throw createError({ statusCode: 401, message: 'Console service token is required.' })
  }
  if (!hasServiceCapability(auth.scopes || [], 'codocs:documents:write')) {
    throw createError({ statusCode: 403, message: 'Missing required service scope: codocs:documents:write' })
  }
  if (sourceApp(auth) !== 'altoc') {
    throw createError({ statusCode: 403, message: 'Service caller is not allowed for this endpoint.' })
  }
}

function genericRuntimeRoute(apiPath: string, method: RuntimeMethod): RuntimeRoute | null {
  if (apiPath === '/api/reviews/publish-requests' && method === 'POST') return null

  const mappings: Array<{ prefix: string, runtimePrefix: string, listShape?: ResponseShape }> = [
    { prefix: '/api/cabinet/folders', runtimePrefix: '/v1/codocs/cabinet/folders', listShape: 'successPage' },
    { prefix: '/api/dept-cabinet/folders', runtimePrefix: '/v1/codocs/dept-cabinet/folders', listShape: 'successPage' },
    { prefix: '/api/cabinet', runtimePrefix: '/v1/codocs/cabinet', listShape: 'successItems' },
    { prefix: '/api/dept-cabinet', runtimePrefix: '/v1/codocs/dept-cabinet', listShape: 'successItems' },
    { prefix: '/api/dept-shares', runtimePrefix: '/v1/codocs/dept-shares', listShape: 'successPage' },
    { prefix: '/api/reviews/templates', runtimePrefix: '/v1/codocs/reviews/templates', listShape: 'codePageItems' },
    { prefix: '/api/reviews/publish-requests', runtimePrefix: '/v1/codocs/reviews/publish-requests', listShape: 'successPage' }
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

function pathSuffix(pathname: string, prefix: string) {
  if (pathname === prefix) return ''
  if (pathname.startsWith(`${prefix}/`)) return pathname.slice(prefix.length)
  return null
}

function isSingleSegmentSuffix(suffix: string) {
  return /^\/[^/]+$/.test(suffix)
}

function isRuntimeBackedBffPath(apiPath: string, method: RuntimeMethod) {
  if (apiPath === '/api/document-access/check' && method === 'POST') return true
  if (/^\/api\/document-access\/policies\/[^/]+$/.test(apiPath) && (method === 'GET' || method === 'PUT' || method === 'PATCH')) return true
  if (apiPath === '/api/document-access/audit-logs' && method === 'GET') return true
  if (apiPath === '/api/documents' && method === 'POST') return true
  if (apiPath === '/api/documents/stats/my' && method === 'GET') return true
  if (apiPath === '/api/documents/upload' && method === 'POST') return true
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
  if (apiPath === '/api/reviews' && method === 'POST') return true
  if (/^\/api\/reviews\/by-document\/[^/]+$/.test(apiPath) && method === 'GET') return true
  if (apiPath === '/api/reviews/by-oss-path' && method === 'GET') return true
  if (/^\/api\/reviews\/[^/]+$/.test(apiPath) && method === 'GET') return true
  if (/^\/api\/reviews\/publish-requests\/[^/]+$/.test(apiPath) && method === 'GET') return true
  if (/^\/api\/reviews\/publish-requests\/[^/]+\/workflow-instance$/.test(apiPath) && method === 'POST') return true
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
    createdAt: row.created_at ?? row.createdAt
  }
}
