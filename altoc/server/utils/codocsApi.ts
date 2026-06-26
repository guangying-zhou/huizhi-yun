import { buildAppHomeUrl } from '@hzy/foundation/server/utils/appUrls'
import { getConsoleRuntimeConfig } from '@hzy/foundation/server/utils/consoleRuntime'
import { requestServiceAccessToken } from '@hzy/foundation/server/utils/serviceOidc'

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
