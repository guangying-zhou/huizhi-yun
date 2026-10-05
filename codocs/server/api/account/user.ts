/**
 * 根据用户名获取目录用户详情
 * 路由: GET /api/account/user?uid=xxx
 */
import { requireCurrentRequestUid } from '~~/server/utils/authIdentity'
import { fetchDirectoryUsersByService } from '~~/server/utils/directoryService'
import type { AccountUser } from '~/types/account'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const uid = query.uid as string

  if (!uid) {
    throw createError({
      statusCode: 400,
      message: 'Missing uid parameter'
    })
  }

  requireCurrentRequestUid(event, uid, '无权查看其他用户的目录详情')

  const response = await fetchDirectoryUsersByService(event, { search: uid })
  const accountUser = response.data.items.find(item => item.uid === uid) as AccountUser | undefined

  if (!accountUser) {
    throw createError({
      statusCode: 404,
      message: 'User not found in Console Directory'
    })
  }

  // 兼容两种格式：优先使用嵌套的 department，否则使用扁平的 deptCode/deptName
  let department = null
  if (accountUser.department) {
    department = accountUser.department
  } else if (accountUser.deptCode && accountUser.deptName) {
    // 将扁平结构转换为嵌套结构，统一使用 deptCode 字符串编码
    department = {
      id: accountUser.deptCode,
      name: accountUser.deptName,
      code: accountUser.deptCode
    }
  }

  const result = {
    id: accountUser.id,
    uid: accountUser.uid,
    realName: accountUser.realName,
    nickname: accountUser.nickname,
    email: '',
    mobile: null,
    avatar: accountUser.avatar,
    department
  }

  return result
})
