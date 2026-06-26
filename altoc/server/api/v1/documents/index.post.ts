import { createError, readBody, type H3Event } from 'h3'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { createCodocsDocument, getCodocsDocumentSummary } from '~~/server/utils/codocsApi'
import { requirePermission } from '~~/server/utils/checkPermission'
import { resolveCurrentAltocDataAccessQuery } from '~~/server/utils/altocScopedAuthorization'

/**
 * 创建文档并关联到实体。
 * Codocs 创建仍由 Altoc Nuxt 编排，关联关系通过 tenant-runtime 写入。
 */
interface DocumentCreateBody {
  entity_type?: string
  entity_id?: number | string
  title?: string
  link_type?: string
  content?: string
  document_uuid?: string
}

interface RuntimeEnvelope<T> {
  code?: number
  data?: T
  message?: string
}

interface EntityDocumentConfig {
  permissionResource: string
  runtimeResource?: string
}

const ENTITY_RESOURCES: Record<string, EntityDocumentConfig> = {
  opportunity: { permissionResource: 'opportunity', runtimeResource: 'opportunities' },
  contract: { permissionResource: 'contract', runtimeResource: 'contracts' },
  quotation: { permissionResource: 'quotation', runtimeResource: 'quotes' },
  customer: { permissionResource: 'customer', runtimeResource: 'customers' },
  lead: { permissionResource: 'lead', runtimeResource: 'leads' },
  tender: { permissionResource: 'quotation', runtimeResource: 'tenders' }
}

function text(value: unknown) {
  return String(value || '').trim()
}

async function callAltocRuntime<T>(
  event: H3Event,
  path: string,
  options: {
    scope: string
    method: 'GET' | 'POST'
    query?: Record<string, unknown>
    body?: Record<string, unknown>
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
    throw createError({ statusCode: 503, message: 'Altoc tenant-runtime is required for document links.' })
  }
  if (runtime.data.code !== undefined && runtime.data.code !== 0) {
    throw createError({ statusCode: 502, message: runtime.data.message || 'Altoc tenant-runtime returned an error.' })
  }
  return runtime.data.data as T
}

async function getEntityCode(
  event: H3Event,
  entityType: string,
  entityId: number,
  query: Record<string, unknown>
) {
  const config = ENTITY_RESOURCES[entityType]
  if (!config) {
    throw createError({ statusCode: 400, statusMessage: '不支持的关联实体类型' })
  }
  if (!config.runtimeResource) return `${entityType}-${entityId}`

  const entity = await callAltocRuntime<Record<string, unknown>>(event, `/v1/altoc/${config.runtimeResource}/${entityId}`, {
    scope: `altoc.read altoc:${config.permissionResource}:view`,
    method: 'GET',
    query
  })
  return text(entity?.code || entity?.contract_no) || `${entityType}-${entityId}`
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  return '无法连接 Codocs 服务'
}

export default defineEventHandler(async (event) => {
  const uid = requireAuth(event)
  const body = await readBody<DocumentCreateBody>(event)

  if (!body.entity_type || !body.entity_id) {
    throw createError({ statusCode: 400, statusMessage: '请指定关联实体' })
  }
  if (!body.title?.trim()) {
    throw createError({ statusCode: 400, statusMessage: '请输入文档标题' })
  }
  const entityType = text(body.entity_type)
  const entityConfig = ENTITY_RESOURCES[entityType]
  if (!entityConfig) {
    throw createError({ statusCode: 400, statusMessage: '不支持的关联实体类型' })
  }
  await requirePermission(event, entityConfig.permissionResource, 'edit')

  // 获取实体编码作为 project_code
  const entityId = Number(body.entity_id)
  if (!Number.isFinite(entityId) || entityId <= 0) {
    throw createError({ statusCode: 400, statusMessage: '无效的关联实体ID' })
  }

  const dataAccessQuery = await resolveCurrentAltocDataAccessQuery(event, entityConfig.permissionResource, 'edit')
  const entityCode = await getEntityCode(event, entityType, entityId, dataAccessQuery)
  if (!entityCode) {
    throw createError({ statusCode: 400, statusMessage: '关联实体不存在' })
  }

  let documentUuid = body.document_uuid

  if (!documentUuid) {
    // 创建新文档
    try {
      // 用 UUID 短码作文件名避免 OSS 路径冲突，保留原标题作为文档显示名
      const shortId = Math.random().toString(36).slice(2, 8)
      const internalTitle = `${body.title.trim()}-${shortId}`
      const created = await createCodocsDocument({
        title: internalTitle,
        ownerUid: uid,
        content: body.content || `# ${body.title.trim()}\n\n`,
        docType: 'sale',
        projectCode: entityCode
      })
      documentUuid = created.uuid
    } catch (error: unknown) {
      const message = getErrorMessage(error)
      console.error('[Documents] Failed to create codocs document:', message)
      throw createError({ statusCode: 500, statusMessage: `创建文档失败：${message}` })
    }
  } else {
    await getCodocsDocumentSummary(documentUuid)
  }

  const link = await callAltocRuntime<Record<string, unknown>>(event, '/v1/altoc/documents', {
    scope: `altoc.write altoc:${entityConfig.permissionResource}:edit`,
    method: 'POST',
    query: dataAccessQuery,
    body: {
      entity_type: entityType,
      entity_id: entityId,
      document_uuid: documentUuid,
      document_title: body.title.trim(),
      link_type: body.link_type || 'general',
      source_type: 'codocs',
      created_by: uid
    }
  })

  return { code: 0, message: '创建成功', data: { id: link?.id, document_uuid: documentUuid } }
})
