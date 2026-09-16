/**
 * 路由: GET /api/account/user-departments
 * 说明: Account 兼容路径，实际数据来自 Console Directory。
 */
import { fetchUserDepartments } from '../../utils/userDepartments'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const uid = typeof query.uid === 'string' ? query.uid.trim() : ''
  const actorUid = await requireCurrentAssetsSessionUid(event, uid)
  const result = await fetchUserDepartments(actorUid)

  return {
    code: 0,
    data: {
      uid: actorUid,
      departments: result.departments,
      primaryDeptCode: result.primaryDeptCode
    }
  }
})
