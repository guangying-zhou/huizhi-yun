/**
 * 删除指定版本记录
 * DELETE /api/documents/:uuid/versions/:versionId
 */

import { requireRequestUid } from '~~/server/utils/authIdentity'
import { callCodocsTenantRuntime } from '~~/server/utils/codocsRuntime'

export default defineEventHandler(async (event) => {
  try {
    const uuid = getRouterParam(event, 'uuid')
    const versionId = getRouterParam(event, 'versionId')

    if (!uuid || !versionId) {
      throw createError({
        statusCode: 400,
        message: '参数不完整'
      })
    }

    const actorUid = requireRequestUid(event)

    await callCodocsTenantRuntime(event, `/v1/codocs/documents/${encodeURIComponent(uuid)}/versions/${encodeURIComponent(versionId)}`, {
      method: 'DELETE',
      scope: 'codocs.write',
      body: { actorUid }
    })

    return {
      success: true
    }
  } catch (error: unknown) {
    console.error('Failed to delete version:', error)
    const statusCode = typeof error === 'object' && error !== null && 'statusCode' in error
      ? Number((error as { statusCode?: unknown }).statusCode) || 500
      : 500
    const message = error instanceof Error
      ? error.message
      : typeof error === 'object' && error !== null && 'message' in error
        ? String((error as { message?: unknown }).message)
        : '删除版本失败'
    throw createError({
      statusCode,
      message
    })
  }
})
