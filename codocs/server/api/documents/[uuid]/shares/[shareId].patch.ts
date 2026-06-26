import { requireRequestUid } from '~~/server/utils/authIdentity'
import { callCodocsTenantRuntime } from '~~/server/utils/codocsRuntime'

export default defineEventHandler(async (event) => {
  const documentId = getRouterParam(event, 'uuid')
  const shareId = getRouterParam(event, 'shareId')
  const body = await readBody(event)
  const { permission } = body
  const actorUid = requireRequestUid(event)

  if (!documentId || !shareId || !permission) {
    throw createError({ statusCode: 400, message: 'Missing required params' })
  }

  await callCodocsTenantRuntime(event, `/v1/codocs/documents/${encodeURIComponent(documentId)}/shares/${encodeURIComponent(shareId)}`, {
    method: 'PATCH',
    scope: 'codocs.write',
    body: { permission, actorUid }
  })

  return { success: true, code: 0, message: 'success' }
})
