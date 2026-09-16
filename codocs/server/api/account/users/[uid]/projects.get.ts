import { fetchDirectoryUserProjectsByService } from '../../../../utils/directoryService'
import { requireCurrentRequestUid } from '../../../../utils/authIdentity'

export default defineEventHandler(async (event) => {
  const uid = getRouterParam(event, 'uid')
  if (!uid) throw createError({ statusCode: 400, message: 'Uid is required' })

  requireCurrentRequestUid(event, uid, '无权查看其他用户的项目关系')

  return await fetchDirectoryUserProjectsByService(event, uid, getQuery(event) as Record<string, unknown>)
})
