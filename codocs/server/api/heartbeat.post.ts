/**
 * 心跳代理
 * POST /api/heartbeat
 *
 * 转发到 Console runtime 心跳 API。
 */

import { getRequestUid } from '~~/server/utils/authIdentity'
import { fetchConsoleRuntimeResponse } from '~~/server/utils/directoryCompat'

export default defineEventHandler(async (event) => {
  const uid = getRequestUid(event)
  if (!uid) {
    return { success: false }
  }

  const body = await readBody(event)

  try {
    await fetchConsoleRuntimeResponse('/api/v1/heartbeat', {
      method: 'POST',
      body: {
        uid,
        sourceApp: body?.sourceApp || 'codocs',
        page: body?.page || null,
        status: body?.status || 'active'
      },
      timeout: 3000
    })
    return { success: true }
  } catch {
    // 心跳失败不影响用户体验，静默处理
    return { success: false }
  }
})
