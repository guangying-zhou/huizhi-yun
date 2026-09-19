import { defineEventHandler, setHeader } from 'h3'
import { requireEnterpriseUser } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { fetchAccessibleDepartments } from '../../../../../../aims/server/utils/userDepartments'

// 保留独立应用的 URL（/api/account/accessible-departments）而不是另起 /api/v1 路径：
// 复用原页面就不改它的契约。数据源本来就是 Console Directory Runtime，
// 这里只是把同一条读取放到企业宿主身份下。
export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store')
  const user = await requireEnterpriseUser(event)
  return { code: 0, data: await fetchAccessibleDepartments(event, user.uid) }
})
