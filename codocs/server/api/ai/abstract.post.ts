/**
 * 保存 AI 摘要
 * POST /api/ai/abstract
 */
import { requireRequestUid } from '~~/server/utils/authIdentity'
import { callCodocsTenantRuntime } from '~~/server/utils/codocsRuntime'

export default defineEventHandler(async (event) => {
  const uid = requireRequestUid(event, '未登录')
  const body = await readBody<{ documentId?: string, abstract?: string }>(event)

  const documentId = String(body?.documentId || '').trim()
  const abstract = String(body?.abstract || '').trim()
  if (!documentId || !abstract) {
    throw createError({ statusCode: 400, message: '参数不完整' })
  }

  await callCodocsTenantRuntime(event, `/v1/codocs/documents/${encodeURIComponent(documentId)}`, {
    method: 'PATCH',
    scope: 'codocs.write',
    body: {
      ai_abstract: abstract,
      actorUid: uid,
      current_user: uid
    }
  })

  return { code: 0, message: 'success' }
})
