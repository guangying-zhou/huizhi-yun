/**
 * Scoped external document view proxy.
 * The browser must not open document_link.external_url directly because the link
 * belongs to an Altoc business object and needs the same data-scope check as
 * Codocs-backed document previews.
 */
import { createError, getQuery, sendRedirect, setHeader, type H3Event } from 'h3'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { requirePermission } from '~~/server/utils/checkPermission'
import { resolveCurrentAltocDataAccessQuery } from '~~/server/utils/altocScopedAuthorization'

interface RuntimeEnvelope<T> {
  code?: number
  data?: T
  message?: string
}

interface DocumentLink {
  id?: number | string
  entity_type?: string | null
  entity_id?: number | string | null
  external_url?: string | null
}

interface EntityDocumentConfig {
  permissionResource: string
}

const ENTITY_RESOURCES: Record<string, EntityDocumentConfig> = {
  opportunity: { permissionResource: 'opportunity' },
  contract: { permissionResource: 'contract' },
  quotation: { permissionResource: 'quotation' },
  customer: { permissionResource: 'customer' },
  lead: { permissionResource: 'lead' },
  tender: { permissionResource: 'quotation' }
}

function text(value: unknown) {
  return String(value || '').trim()
}

function positiveInteger(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 0
}

function safeExternalDocumentUrl(value: string) {
  if (!value) {
    throw createError({ statusCode: 400, statusMessage: '缺少外部文档地址' })
  }

  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw createError({ statusCode: 400, statusMessage: '外部文档地址无效' })
  }

  if (parsed.protocol !== 'https:') {
    throw createError({ statusCode: 403, statusMessage: '外部文档必须使用 HTTPS 地址' })
  }
  if (parsed.username || parsed.password) {
    throw createError({ statusCode: 403, statusMessage: '外部文档地址不允许携带凭据' })
  }
  return parsed.toString()
}

async function callAltocRuntime<T>(
  event: H3Event,
  path: string,
  options: {
    scope: string
    query: Record<string, unknown>
  }
) {
  const runtime = await maybeCallTenantRuntime<RuntimeEnvelope<T>>(event, path, {
    appCode: 'altoc',
    scope: options.scope,
    method: 'GET',
    query: options.query
  })
  if (!runtime.handled) {
    throw createError({ statusCode: 503, message: 'Altoc tenant-runtime is required for external document view.' })
  }
  if (runtime.data.code !== undefined && runtime.data.code !== 0) {
    throw createError({ statusCode: 502, message: runtime.data.message || 'Altoc tenant-runtime returned an error.' })
  }
  return runtime.data.data as T
}

function matchesRequestedExternalLink(link: DocumentLink | undefined, input: {
  url: string
  entityType: string
  entityId: number
}) {
  return text(link?.external_url) === input.url
    && text(link?.entity_type) === input.entityType
    && positiveInteger(link?.entity_id) === input.entityId
}

async function verifyExternalDocumentLinkAccess(
  event: H3Event,
  input: {
    url: string
    entityType: string
    entityId: number
    linkId: string
  }
) {
  const entityConfig = ENTITY_RESOURCES[input.entityType]
  if (!entityConfig) {
    throw createError({ statusCode: 400, statusMessage: '不支持的关联实体类型' })
  }
  if (!input.entityId) {
    throw createError({ statusCode: 400, statusMessage: '请指定关联实体' })
  }
  if (!input.linkId) {
    throw createError({ statusCode: 400, statusMessage: '请指定文档关联记录' })
  }

  await requirePermission(event, entityConfig.permissionResource, 'view')
  const dataAccessQuery = await resolveCurrentAltocDataAccessQuery(event, entityConfig.permissionResource, 'view')
  const query = {
    entity_type: input.entityType,
    entity_id: input.entityId,
    ...dataAccessQuery
  }
  const scope = `altoc.read altoc:${entityConfig.permissionResource}:view`

  const link = await callAltocRuntime<DocumentLink>(
    event,
    `/v1/altoc/documents/${encodeURIComponent(input.linkId)}`,
    { scope, query }
  )
  if (matchesRequestedExternalLink(link, input)) return

  throw createError({ statusCode: 404, statusMessage: '外部文档未关联或无权预览' })
}

export default defineEventHandler(async (event) => {
  requireAuth(event)
  const query = getQuery(event)
  const url = safeExternalDocumentUrl(text(query.url))
  const entityType = text(query.entity_type || query.entityType)
  const entityId = positiveInteger(query.entity_id || query.entityId)
  const linkId = text(query.link_id || query.linkId)

  await verifyExternalDocumentLinkAccess(event, {
    url,
    entityType,
    entityId,
    linkId
  })

  setHeader(event, 'Cache-Control', 'private, no-store')
  return sendRedirect(event, url, 302)
})
