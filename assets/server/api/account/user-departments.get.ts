/**
 * 路由: GET /api/account/user-departments
 * 说明: Account 兼容路径，实际数据来自 Console Directory。
 */
import { fetchUserDepartments } from '../../utils/userDepartments'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const uid = typeof query.uid === 'string' ? query.uid.trim() : ''

  if (uid) {
    const result = await fetchUserDepartments(uid)
    return {
      code: 0,
      data: {
        uid,
        departments: result.departments,
        primaryDeptCode: result.primaryDeptCode
      }
    }
  }

  return await fetchDirectoryApi('/api/v1/directory/user-departments', {
    params: query
  })
})
