import { fetchConsoleDirectoryApi } from '@hzy/foundation/server/utils/directoryApi'

export default defineEventHandler((event) => {
  const uid = String(getRouterParam(event, 'uid') || '').trim()
  if (!uid) throw createError({ statusCode: 400, message: 'uid is required' })

  const config = useRuntimeConfig(event)
  if (config.hzy?.financeDevPermissions && uid === 'finance-dev') {
    return {
      code: 0,
      data: {
        uid: 'finance-dev',
        email: 'finance-dev@local',
        realName: '财务管理员',
        avatar: null
      }
    }
  }

  return fetchConsoleDirectoryApi(`/users/${encodeURIComponent(uid)}`)
})
