/**
 * Grant readonly preview access for embedded Codocs previews.
 * POST /api/v1/documents/:uuid/preview-access
 *
 * Service-only endpoint. Callers must verify their own business access first.
 */
import { verifyInternalApi } from '~~/server/utils/internalApi'
import { callCodocsTenantRuntime } from '~~/server/utils/codocsRuntime'

export default defineEventHandler(async (event) => {
  await verifyInternalApi(event, { scopes: ['codocs:documents:write'] })

  const uuid = String(getRouterParam(event, 'uuid') || '').trim()
  if (!uuid) {
    throw createError({ statusCode: 400, message: '缺少文档 UUID' })
  }

  const body = await readBody<{
    actorUid?: string
    actor_uid?: string
    sourceApp?: string
    source_app?: string
    sourceProjectCode?: string
    source_project_code?: string
  }>(event)

  const actorUid = String(body.actorUid || body.actor_uid || '').trim()
  const sourceProjectCode = String(body.sourceProjectCode || body.source_project_code || '').trim()
  if (!actorUid) {
    throw createError({ statusCode: 400, message: 'actorUid 不能为空' })
  }
  if (!sourceProjectCode) {
    throw createError({ statusCode: 400, message: 'sourceProjectCode 不能为空' })
  }

  const data = await callCodocsTenantRuntime(event, `/v1/codocs/documents/${encodeURIComponent(uuid)}/relations/preview-access`, {
    method: 'POST',
    scope: 'codocs.write',
    body: {
      actorUid,
      sourceApp: body.sourceApp || body.source_app || 'aims',
      sourceProjectCode
    }
  })

  return {
    code: 0,
    data
  }
})
