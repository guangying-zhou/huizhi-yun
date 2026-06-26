import { createError, getRouterParam } from 'h3'
import { callCodocsTenantRuntime } from '~~/server/utils/codocsRuntime'
import { requireRequestUid } from '~~/server/utils/authIdentity'
import { deleteDocument } from '~~/server/utils/oss'

interface DeleteInfoResult {
  id?: number
  restoredBookmarkId?: string | null
  oss_path?: string | null
}

export default defineEventHandler(async (event) => {
  requireRequestUid(event)

  const id = getRouterParam(event, 'id')
  const numericId = Number(id || 0)
  if (!Number.isInteger(numericId) || numericId <= 0) {
    throw createError({ statusCode: 400, message: '无效的文章ID' })
  }

  const result = await callCodocsTenantRuntime<DeleteInfoResult>(event, `/v1/codocs/info/items/${encodeURIComponent(String(numericId))}`, {
    method: 'DELETE',
    scope: 'codocs.write'
  })

  if (result.oss_path) {
    try {
      await deleteDocument(result.oss_path)
    } catch (error) {
      console.warn(`[Info Delete] OSS 删除失败 (忽略): ${result.oss_path}`, error)
    }
  }

  return {
    success: true,
    data: {
      id: result.id || numericId,
      restoredBookmarkId: result.restoredBookmarkId || null
    }
  }
})
