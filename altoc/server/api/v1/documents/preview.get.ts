/**
 * 代理获取 Codocs 文档内容（用于预览）
 * GET /api/v1/documents/preview?uuid=xxx&entity_type=contract&entity_id=1&link_id=2
 */
import { createError, getQuery, type H3Event } from 'h3'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { getCodocsAltocEntityDocumentContent, type AltocEntityType } from '~~/server/utils/codocsApi'
import { requireRequestUid } from '~~/server/utils/authIdentity'
import { requirePermission } from '~~/server/utils/checkPermission'
import { resolveCurrentAltocDataAccessQuery } from '~~/server/utils/altocScopedAuthorization'

interface DocumentPreviewResponse {
  code: number
  message: string
  data: {
    title: string
    content: string
    doc_type: string
    owner_uid: string
    updated_at: string
  }
}

interface RuntimeEnvelope<T> {
  code?: number
  data?: T
  message?: string
}

interface DocumentLink {
  id?: number | string
  entity_type?: string | null
  entity_id?: number | string | null
  document_uuid?: string | null
}

interface DocumentLinksPayload {
  items?: DocumentLink[]
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

function getStatusCode(error: unknown) {
  const statusCode = (error as { statusCode?: unknown })?.statusCode
  return typeof statusCode === 'number' ? statusCode : 500
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
    throw createError({ statusCode: 503, message: 'Altoc tenant-runtime is required for document preview.' })
  }
  if (runtime.data.code !== undefined && runtime.data.code !== 0) {
    throw createError({ statusCode: 502, message: runtime.data.message || 'Altoc tenant-runtime returned an error.' })
  }
  return runtime.data.data as T
}

function normalizeDocumentLinks(payload: DocumentLinksPayload | DocumentLink[] | undefined) {
  if (Array.isArray(payload)) return payload
  if (Array.isArray(payload?.items)) return payload.items
  return []
}

function matchesRequestedLink(link: DocumentLink | undefined, input: {
  uuid: string
  entityType: string
  entityId: number
}) {
  return text(link?.document_uuid) === input.uuid
    && text(link?.entity_type) === input.entityType
    && positiveInteger(link?.entity_id) === input.entityId
}

async function verifyDocumentLinkAccess(
  event: H3Event,
  input: {
    uuid: string
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

  await requirePermission(event, entityConfig.permissionResource, 'view')
  const dataAccessQuery = await resolveCurrentAltocDataAccessQuery(event, entityConfig.permissionResource, 'view')
  const query = {
    entity_type: input.entityType,
    entity_id: input.entityId,
    ...dataAccessQuery
  }
  const scope = `altoc.read altoc:${entityConfig.permissionResource}:view`

  if (input.linkId) {
    const link = await callAltocRuntime<DocumentLink>(
      event,
      `/v1/altoc/documents/${encodeURIComponent(input.linkId)}`,
      { scope, query }
    )
    if (matchesRequestedLink(link, input)) return
  } else {
    const links = normalizeDocumentLinks(await callAltocRuntime<DocumentLinksPayload | DocumentLink[]>(
      event,
      '/v1/altoc/documents',
      {
        scope,
        query: {
          ...query,
          page_size: 100
        }
      }
    ))
    if (links.some(link => matchesRequestedLink(link, input))) return
  }

  throw createError({ statusCode: 404, statusMessage: '文档未关联或无权预览' })
}

export default defineEventHandler(async (event): Promise<DocumentPreviewResponse> => {
  const actorUid = requireRequestUid(event)
  const query = getQuery(event)
  const uuid = text(query.uuid)
  const entityType = text(query.entity_type || query.entityType)
  const entityId = positiveInteger(query.entity_id || query.entityId)
  const linkId = text(query.link_id || query.linkId)
  if (!uuid) {
    throw createError({ statusCode: 400, statusMessage: '请提供文档UUID' })
  }
  if (!entityType || !entityId) {
    throw createError({ statusCode: 400, statusMessage: '请指定关联实体' })
  }

  await verifyDocumentLinkAccess(event, {
    uuid,
    entityType,
    entityId,
    linkId
  })

  try {
    const document = await getCodocsAltocEntityDocumentContent({
      event,
      actorUid,
      entityType: entityType as AltocEntityType,
      entityId,
      documentUuid: uuid
    })

    return {
      code: 0,
      message: 'ok',
      data: {
        title: document.title || '',
        content: document.content || '',
        doc_type: document.docType || '',
        owner_uid: '',
        updated_at: document.updatedAt || ''
      }
    }
  } catch (error: unknown) {
    throw createError({ statusCode: getStatusCode(error), statusMessage: '获取文档内容失败' })
  }
})
