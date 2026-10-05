import { getQuery } from 'h3'
import { readConsoleEmploymentLifecycleStatus } from '@hzy/foundation/server/utils/consoleTenantRuntimeClient'
import { requireConsoleServiceActor } from '~~/server/utils/vault'

// 入职收口判定所需的下游状态。
//
// Platform 授权操作归 Console 所有，People 不得直接访问 Platform，因此这里
// 只读地转述目录生效情况与 Platform 下一跳状态。返回稳定状态串，不返回命令、
// receipt 或任何目录内部字段。
export default defineEventHandler(async (event) => {
  await requireConsoleServiceActor(event, 'console', 'console:directory-employment:sync', {
    requireBoundTargetApp: true
  })
  const uid = String(getQuery(event).uid || '').trim()
  if (!uid) throw createError({ statusCode: 400, message: 'uid is required.' })

  const runtime = await readConsoleEmploymentLifecycleStatus(event, uid)
  const data = (runtime.data || {}) as Record<string, unknown>
  return {
    code: 0,
    message: 'ok',
    data: {
      uid,
      directoryApplied: Boolean(data.directoryApplied),
      platformStatus: String(data.platformStatus || '')
    }
  }
})
